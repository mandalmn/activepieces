import { isNil, tryCatchSync } from '@activepieces/core-utils'
import { AWSProviderConfig, SecretManagerProviderId } from '@activepieces/shared'
import { GetSecretValueCommand, ListSecretsCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SecretManagerProvider, throwFetchFailed, throwVerifyFailed } from './secret-manager-provider'

export const awsSecretsManagerProvider: SecretManagerProvider<AWSProviderConfig> = {
    async verify({ config }) {
        try {
            await createClient({ config }).send(new ListSecretsCommand({ MaxResults: 1 }))
        }
        catch (error) {
            throwVerifyFailed({ error, providerId: SecretManagerProviderId.AWS })
        }
    },

    async fetch({ config, path }) {
        try {
            const { secretId, jsonKey } = splitPath({ path })
            const response = await createClient({ config }).send(new GetSecretValueCommand({ SecretId: secretId }))
            const secretString = response.SecretString
            if (isNil(secretString)) {
                throw new Error(`"${secretId}" holds binary data, which cannot be used as a credential`)
            }
            if (isNil(jsonKey)) {
                return secretString
            }
            return readJsonKey({ secretString, jsonKey, secretId })
        }
        catch (error) {
            throwFetchFailed({ error, providerId: SecretManagerProviderId.AWS, path })
        }
    },
}

function readJsonKey({ secretString, jsonKey, secretId }: { secretString: string, jsonKey: string, secretId: string }): string {
    const { data } = tryCatchSync(() => JSON.parse(secretString))
    if (isNil(data) || typeof data !== 'object') {
        throw new Error(`"${secretId}" is not JSON, so "${jsonKey}" cannot be read from it`)
    }
    const value = (data as Record<string, unknown>)[jsonKey]
    if (isNil(value)) {
        throw new Error(`"${secretId}" has no key named "${jsonKey}"`)
    }
    return String(value)
}

function splitPath({ path }: { path: string }): { secretId: string, jsonKey: string | null } {
    const separatorAt = path.lastIndexOf(':')
    if (separatorAt <= 0) {
        return { secretId: path, jsonKey: null }
    }
    return {
        secretId: path.slice(0, separatorAt),
        jsonKey: path.slice(separatorAt + 1),
    }
}

function createClient({ config }: { config: AWSProviderConfig }): SecretsManagerClient {
    return new SecretsManagerClient({
        region: config.region,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    })
}
