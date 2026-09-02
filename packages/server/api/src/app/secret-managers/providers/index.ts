import { SecretManagerProviderId } from '@activepieces/shared'
import { awsSecretsManagerProvider } from './aws-secrets-manager-provider'
import { cyberarkConjurProvider } from './cyberark-conjur-provider'
import { hashicorpVaultProvider } from './hashicorp-vault-provider'
import { onePasswordProvider } from './onepassword-provider'
import { SecretManagerCredentials } from './secret-manager-provider'

export const secretManagerProviders = {
    verify({ credentials }: { credentials: SecretManagerCredentials }): Promise<void> {
        switch (credentials.providerId) {
            case SecretManagerProviderId.HASHICORP:
                return hashicorpVaultProvider.verify({ config: credentials.config })
            case SecretManagerProviderId.AWS:
                return awsSecretsManagerProvider.verify({ config: credentials.config })
            case SecretManagerProviderId.CYBERARK:
                return cyberarkConjurProvider.verify({ config: credentials.config })
            case SecretManagerProviderId.ONEPASSWORD:
                return onePasswordProvider.verify({ config: credentials.config })
        }
    },

    fetch({ credentials, path }: { credentials: SecretManagerCredentials, path: string }): Promise<string> {
        switch (credentials.providerId) {
            case SecretManagerProviderId.HASHICORP:
                return hashicorpVaultProvider.fetch({ config: credentials.config, path })
            case SecretManagerProviderId.AWS:
                return awsSecretsManagerProvider.fetch({ config: credentials.config, path })
            case SecretManagerProviderId.CYBERARK:
                return cyberarkConjurProvider.fetch({ config: credentials.config, path })
            case SecretManagerProviderId.ONEPASSWORD:
                return onePasswordProvider.fetch({ config: credentials.config, path })
        }
    },
}

export { SecretManagerCredentials }
