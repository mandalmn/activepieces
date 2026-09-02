import { hooksFactory } from '../helper/hooks-factory'
import { secretManagerReference } from './secret-manager-reference'
import { secretManagerService } from './secret-manager.service'

export const secretResolver = hooksFactory.create<SecretResolver>((log) => ({
    resolveString: (params) => secretManagerService(log).resolveString(params),
    resolveObject: (params) => secretManagerService(log).resolveObject(params),
    resolveUnknownValue: (params) => secretManagerService(log).resolveUnknownValue(params),
}))

export const usesSecretManager = secretManagerReference.contains

export type SecretResolver = {
    resolveString(params: { key: string, platformId: string, projectIds?: string[], throwOnFailure?: boolean }): Promise<string>
    resolveObject<T extends Record<string, unknown>>(params: { value: T, platformId: string, projectIds?: string[], throwOnFailure?: boolean }): Promise<T>
    resolveUnknownValue(params: { value: unknown, platformId: string, projectIds?: string[], throwOnFailure: boolean }): Promise<unknown>
}
