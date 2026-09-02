import { createClient } from '@1password/sdk'
import { isNil } from '@activepieces/core-utils'
import { OnePasswordProviderConfig, SecretManagerProviderId } from '@activepieces/shared'
import { SecretManagerProvider, throwFetchFailed, throwVerifyFailed } from './secret-manager-provider'

const INTEGRATION_NAME = 'Activepieces'
const INTEGRATION_VERSION = 'v1.0.0'

export const onePasswordProvider: SecretManagerProvider<OnePasswordProviderConfig> = {
    async verify({ config }) {
        try {
            const client = await connect({ config })
            await client.vaults.list()
        }
        catch (error) {
            throwVerifyFailed({ error, providerId: SecretManagerProviderId.ONEPASSWORD })
        }
    },

    async fetch({ config, path }) {
        try {
            const client = await connect({ config })
            const secret = await client.secrets.resolve(path)
            if (isNil(secret)) {
                throw new Error(`No value stored under "${path}"`)
            }
            return secret
        }
        catch (error) {
            throwFetchFailed({ error, providerId: SecretManagerProviderId.ONEPASSWORD, path })
        }
    },
}

function connect({ config }: { config: OnePasswordProviderConfig }) {
    return createClient({
        auth: config.serviceAccountToken,
        integrationName: INTEGRATION_NAME,
        integrationVersion: INTEGRATION_VERSION,
    })
}
