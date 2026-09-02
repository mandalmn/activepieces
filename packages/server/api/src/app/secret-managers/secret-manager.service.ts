import { ActivepiecesError, apId, ErrorCode, isNil, SeekPage } from '@activepieces/core-utils'
import {
    AWSProviderConfigSchema,
    ConnectSecretManagerRequest,
    CyberarkConjurProviderConfigSchema,
    HashicorpProviderConfigSchema,
    OnePasswordProviderConfigSchema,
    SecretManagerConnectionScope,
    SecretManagerConnectionWithStatus,
    SecretManagerProviderId,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { encryptUtils } from '../helper/encryption'
import { secretManagerProviders } from './providers'
import { SecretManagerCredentials } from './providers/secret-manager-provider'
import { secretManagerCache } from './secret-manager-cache'
import { secretManagerReference } from './secret-manager-reference'
import { SecretManagerEntity, SecretManagerSchema } from './secret-manager.entity'

export const secretManagerRepo = repoFactory(SecretManagerEntity)

export const secretManagerService = (log: FastifyBaseLogger): SecretManagerService => ({
    async list({ platformId, projectId }: ListParams): Promise<SeekPage<SecretManagerConnectionWithStatus>> {
        const rows = await secretManagerRepo().findBy({ platformId })
        const visible = rows.filter((row) => isNil(projectId) || isVisibleToProject({ row, projectId }))
        return {
            data: visible.map(toConnectionWithStatus),
            next: null,
            previous: null,
        }
    },

    async create({ platformId, request }: CreateParams): Promise<SecretManagerConnectionWithStatus> {
        await secretManagerProviders.verify({ credentials: request })
        const row = await insert({ platformId, request })
        return toConnectionWithStatus(row)
    },

    async update({ id, platformId, request }: UpdateParams): Promise<SecretManagerConnectionWithStatus> {
        await getOneOrThrow({ id, platformId })
        await secretManagerProviders.verify({ credentials: request })
        const row = await overwrite({ id, platformId, request })
        await secretManagerCache.forget({ platformId, connectionId: id, log })
        return toConnectionWithStatus(row)
    },

    async delete({ id, platformId }: IdParams): Promise<void> {
        await getOneOrThrow({ id, platformId })
        await secretManagerRepo().delete({ id, platformId })
        await secretManagerCache.forget({ platformId, connectionId: id, log })
    },

    async clearCache({ platformId, connectionId }: ClearCacheParams): Promise<void> {
        await secretManagerCache.forget({ platformId, connectionId, log })
    },

    async resolveString({ key, platformId, projectIds, throwOnFailure = true }: ResolveStringParams): Promise<string> {
        const resolved = await resolveUnknown({ value: key, platformId, projectIds, throwOnFailure, log })
        return typeof resolved === 'string' ? resolved : key
    },

    async resolveObject<T extends Record<string, unknown>>({ value, platformId, projectIds, throwOnFailure = true }: ResolveObjectParams<T>): Promise<T> {
        const entries = await Promise.all(Object.entries(value).map(async ([field, fieldValue]) => [
            field,
            await resolveUnknown({ value: fieldValue, platformId, projectIds, throwOnFailure, log }),
        ] as const))
        return { ...value, ...Object.fromEntries(entries) }
    },

    resolveUnknownValue({ value, platformId, projectIds, throwOnFailure }: ResolveUnknownParams): Promise<unknown> {
        return resolveUnknown({ value, platformId, projectIds, throwOnFailure, log })
    },
})

async function resolveUnknown({ value, platformId, projectIds, throwOnFailure, log }: ResolveUnknownParams & { log: FastifyBaseLogger }): Promise<unknown> {
    if (typeof value === 'string') {
        const reference = secretManagerReference.parse(value)
        if (isNil(reference)) {
            return value
        }
        try {
            return await readSecret({ reference, platformId, projectIds, log })
        }
        catch (error) {
            if (throwOnFailure) {
                throw error
            }
            log.warn({ platform: { id: platformId }, connection: { id: reference.connectionId }, error }, '[secretManager] Could not resolve a secret reference')
            return value
        }
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map((entry) => resolveUnknown({ value: entry, platformId, projectIds, throwOnFailure, log })))
    }
    if (isPlainObject(value)) {
        const entries = await Promise.all(Object.entries(value).map(async ([field, fieldValue]) => [
            field,
            await resolveUnknown({ value: fieldValue, platformId, projectIds, throwOnFailure, log }),
        ] as const))
        return Object.fromEntries(entries)
    }
    return value
}

async function readSecret({ reference, platformId, projectIds, log }: ReadSecretParams): Promise<string> {
    const { connectionId, path } = reference
    const row = await getOneOrThrow({ id: connectionId, platformId })
    assertReachableFromProjects({ row, projectIds })
    const cached = await secretManagerCache.read({ platformId, connectionId, path, log })
    if (!isNil(cached)) {
        return cached
    }
    const secret = await secretManagerProviders.fetch({ credentials: await decryptCredentials({ row }), path })
    await secretManagerCache.write({ platformId, connectionId, path, value: secret, log })
    return secret
}

async function insert({ platformId, request }: CreateParams): Promise<SecretManagerSchema> {
    const id = apId()
    await secretManagerRepo().insert({ id, platformId, ...await toColumns({ request }) })
    return getOneOrThrow({ id, platformId })
}

async function overwrite({ id, platformId, request }: UpdateParams): Promise<SecretManagerSchema> {
    await secretManagerRepo().update({ id, platformId }, await toColumns({ request }))
    return getOneOrThrow({ id, platformId })
}

async function toColumns({ request }: { request: ConnectSecretManagerRequest }) {
    return {
        providerId: request.providerId,
        name: request.name,
        scope: request.scope,
        projectIds: request.scope === SecretManagerConnectionScope.PROJECT ? (request.projectIds ?? []) : null,
        auth: await encryptUtils.encryptObject(request.config),
    }
}

async function getOneOrThrow({ id, platformId }: IdParams): Promise<SecretManagerSchema> {
    const row = await secretManagerRepo().findOneBy({ id, platformId })
    if (isNil(row)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { entityType: 'secret_manager_connection', entityId: id },
        })
    }
    return row
}

function assertReachableFromProjects({ row, projectIds }: { row: SecretManagerSchema, projectIds: string[] | undefined }): void {
    if (row.scope !== SecretManagerConnectionScope.PROJECT) {
        return
    }
    const allowed = row.projectIds ?? []
    const reachable = isNil(projectIds) || projectIds.some((projectId) => allowed.includes(projectId))
    if (!reachable) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'This secret manager connection is not shared with this project.' },
        })
    }
}

async function decryptCredentials({ row }: { row: SecretManagerSchema }): Promise<SecretManagerCredentials> {
    if (isNil(row.auth)) {
        throw new ActivepiecesError({
            code: ErrorCode.SECRET_MANAGER_CONNECTION_FAILED,
            params: { message: 'This secret manager connection has no stored credentials.', provider: row.providerId },
        })
    }
    const config = await encryptUtils.decryptObject<unknown>(row.auth)
    switch (row.providerId) {
        case SecretManagerProviderId.HASHICORP:
            return { providerId: row.providerId, config: HashicorpProviderConfigSchema.parse(config) }
        case SecretManagerProviderId.AWS:
            return { providerId: row.providerId, config: AWSProviderConfigSchema.parse(config) }
        case SecretManagerProviderId.CYBERARK:
            return { providerId: row.providerId, config: CyberarkConjurProviderConfigSchema.parse(config) }
        case SecretManagerProviderId.ONEPASSWORD:
            return { providerId: row.providerId, config: OnePasswordProviderConfigSchema.parse(config) }
    }
}

function isVisibleToProject({ row, projectId }: { row: SecretManagerSchema, projectId: string }): boolean {
    if (row.scope !== SecretManagerConnectionScope.PROJECT) {
        return true
    }
    return (row.projectIds ?? []).includes(projectId)
}

function toConnectionWithStatus(row: SecretManagerSchema): SecretManagerConnectionWithStatus {
    const configured = !isNil(row.auth)
    const base = {
        id: row.id,
        created: row.created,
        updated: row.updated,
        platformId: row.platformId,
        providerId: row.providerId,
        name: row.name,
        connection: { configured, connected: configured },
    }
    if (row.scope === SecretManagerConnectionScope.PROJECT) {
        return { ...base, scope: SecretManagerConnectionScope.PROJECT, projectIds: row.projectIds ?? [] }
    }
    return { ...base, scope: SecretManagerConnectionScope.PLATFORM }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && !isNil(value) && !Array.isArray(value)
}

export type SecretManagerService = {
    list(params: ListParams): Promise<SeekPage<SecretManagerConnectionWithStatus>>
    create(params: CreateParams): Promise<SecretManagerConnectionWithStatus>
    update(params: UpdateParams): Promise<SecretManagerConnectionWithStatus>
    delete(params: IdParams): Promise<void>
    clearCache(params: ClearCacheParams): Promise<void>
    resolveString(params: ResolveStringParams): Promise<string>
    resolveObject<T extends Record<string, unknown>>(params: ResolveObjectParams<T>): Promise<T>
    resolveUnknownValue(params: ResolveUnknownParams): Promise<unknown>
}

type ReadSecretParams = {
    reference: { connectionId: string, path: string }
    platformId: string
    projectIds: string[] | undefined
    log: FastifyBaseLogger
}

type ListParams = {
    platformId: string
    projectId?: string
}

type CreateParams = {
    platformId: string
    request: ConnectSecretManagerRequest
}

type UpdateParams = {
    id: string
    platformId: string
    request: ConnectSecretManagerRequest
}

type IdParams = {
    id: string
    platformId: string
}

type ClearCacheParams = {
    platformId: string
    connectionId?: string
}

type ResolveStringParams = {
    key: string
    platformId: string
    projectIds?: string[]
    throwOnFailure?: boolean
}

type ResolveObjectParams<T> = {
    value: T
    platformId: string
    projectIds?: string[]
    throwOnFailure?: boolean
}

type ResolveUnknownParams = {
    value: unknown
    platformId: string
    projectIds?: string[]
    throwOnFailure: boolean
}
