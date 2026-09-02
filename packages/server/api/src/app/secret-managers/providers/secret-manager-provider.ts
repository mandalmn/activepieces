import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import {
    AWSProviderConfig,
    CyberarkConjurProviderConfig,
    HashicorpProviderConfig,
    OnePasswordProviderConfig,
    SecretManagerProviderId,
} from '@activepieces/shared'

export function describeFailure(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }
    if (typeof error === 'string') {
        return error
    }
    return 'Unknown error'
}

export function throwVerifyFailed({ error, providerId }: { error: unknown, providerId: SecretManagerProviderId }): never {
    throw new ActivepiecesError({
        code: ErrorCode.SECRET_MANAGER_CONNECTION_FAILED,
        params: { message: describeFailure(error), provider: providerId },
    })
}

export function throwFetchFailed({ error, providerId, path }: { error: unknown, providerId: SecretManagerProviderId, path: string }): never {
    throw new ActivepiecesError({
        code: ErrorCode.SECRET_MANAGER_GET_SECRET_FAILED,
        params: { message: `[${path}] ${describeFailure(error)}`, provider: providerId, request: { path } },
    })
}

export type SecretManagerProvider<TConfig> = {
    verify(params: { config: TConfig }): Promise<void>
    fetch(params: { config: TConfig, path: string }): Promise<string>
}

export type SecretManagerCredentials =
    | { providerId: SecretManagerProviderId.HASHICORP, config: HashicorpProviderConfig }
    | { providerId: SecretManagerProviderId.AWS, config: AWSProviderConfig }
    | { providerId: SecretManagerProviderId.CYBERARK, config: CyberarkConjurProviderConfig }
    | { providerId: SecretManagerProviderId.ONEPASSWORD, config: OnePasswordProviderConfig }
