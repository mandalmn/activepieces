import { isNil } from '@activepieces/core-utils'
import { safeHttp } from '@activepieces/server-utils'
import { HashicorpProviderConfig, SecretManagerProviderId } from '@activepieces/shared'
import { SecretManagerProvider, throwFetchFailed, throwVerifyFailed } from './secret-manager-provider'

export const hashicorpVaultProvider: SecretManagerProvider<HashicorpProviderConfig> = {
    async verify({ config }) {
        try {
            await login({ config })
        }
        catch (error) {
            throwVerifyFailed({ error, providerId: SecretManagerProviderId.HASHICORP })
        }
    },

    async fetch({ config, path }) {
        try {
            const { mount, key } = splitPath({ path })
            const token = await login({ config })
            const response = await request({
                config,
                token,
                method: 'GET',
                url: `${baseUrl({ config })}/v1/${mount}`,
            })
            const secret = response.data?.data?.data?.[key]
            if (isNil(secret)) {
                throw new Error(`No value stored under "${key}"`)
            }
            return String(secret)
        }
        catch (error) {
            throwFetchFailed({ error, providerId: SecretManagerProviderId.HASHICORP, path })
        }
    },
}

async function login({ config }: { config: HashicorpProviderConfig }): Promise<string> {
    const response = await request({
        config,
        method: 'POST',
        url: `${baseUrl({ config })}/v1/auth/approle/login`,
        body: { role_id: config.roleId, secret_id: config.secretId },
    })
    const token = response.data?.auth?.client_token
    if (isNil(token)) {
        throw new Error('Vault did not return a client token for this AppRole')
    }
    return String(token)
}

function splitPath({ path }: { path: string }): { mount: string, key: string } {
    const segments = path.split('/').filter((segment) => segment.length > 0)
    if (segments.length < 2) {
        throw new Error('Expected a path shaped like secret/data/my-secret/my-key')
    }
    return {
        mount: segments.slice(0, -1).join('/'),
        key: segments[segments.length - 1],
    }
}

function baseUrl({ config }: { config: HashicorpProviderConfig }): string {
    return config.url.trim().replace(/\/+$/, '')
}

function request({ config, token, method, url, body }: RequestParams) {
    return safeHttp.axios.request({
        method,
        url,
        data: body,
        headers: {
            ...(isNil(token) ? {} : { 'X-Vault-Token': token }),
            ...(isNil(config.namespace) || config.namespace.length === 0 ? {} : { 'X-Vault-Namespace': config.namespace }),
        },
    })
}

type RequestParams = {
    config: HashicorpProviderConfig
    token?: string
    method: 'GET' | 'POST'
    url: string
    body?: Record<string, unknown>
}
