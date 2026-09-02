import { isNil } from '@activepieces/core-utils'
import { safeHttp } from '@activepieces/server-utils'
import { CyberarkConjurProviderConfig, SecretManagerProviderId } from '@activepieces/shared'
import { SecretManagerProvider, throwFetchFailed, throwVerifyFailed } from './secret-manager-provider'

export const cyberarkConjurProvider: SecretManagerProvider<CyberarkConjurProviderConfig> = {
    async verify({ config }) {
        try {
            await authenticate({ config })
        }
        catch (error) {
            throwVerifyFailed({ error, providerId: SecretManagerProviderId.CYBERARK })
        }
    },

    async fetch({ config, path }) {
        try {
            const token = await authenticate({ config })
            const response = await safeHttp.axios.request({
                method: 'GET',
                url: `${baseUrl({ config })}/secrets/${encodeURIComponent(config.organizationAccountName)}/variable/${encodeURIComponent(path)}`,
                headers: { Authorization: `Token token="${token}"` },
                responseType: 'text',
            })
            if (isNil(response.data)) {
                throw new Error(`No value stored under "${path}"`)
            }
            return String(response.data)
        }
        catch (error) {
            throwFetchFailed({ error, providerId: SecretManagerProviderId.CYBERARK, path })
        }
    },
}

async function authenticate({ config }: { config: CyberarkConjurProviderConfig }): Promise<string> {
    const response = await safeHttp.axios.request({
        method: 'POST',
        url: `${baseUrl({ config })}/authn/${encodeURIComponent(config.organizationAccountName)}/${encodeURIComponent(config.loginId)}/authenticate`,
        data: config.apiKey,
        headers: { 'Content-Type': 'text/plain', 'Accept-Encoding': 'base64' },
        responseType: 'text',
    })
    if (isNil(response.data)) {
        throw new Error('Conjur did not return an access token for this login')
    }
    return String(response.data).trim()
}

function baseUrl({ config }: { config: CyberarkConjurProviderConfig }): string {
    return config.url.trim().replace(/\/+$/, '')
}
