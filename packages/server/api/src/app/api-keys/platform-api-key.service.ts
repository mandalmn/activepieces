import { createHash, randomBytes } from 'node:crypto'
import { ActivepiecesError, apId, ErrorCode, isNil, SeekPage } from '@activepieces/core-utils'
import { PLATFORM_API_KEY_PREFIX, PLATFORM_API_KEY_TRUNCATED_LENGTH, PlatformApiKey, PlatformApiKeyWithValue } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { PlatformApiKeyEntity } from './platform-api-key.entity'

const SECRET_BYTES = 32

const platformApiKeyRepo = repoFactory(PlatformApiKeyEntity)

export const platformApiKeyService = (_log: FastifyBaseLogger): PlatformApiKeyService => ({
    async create({ platformId, displayName }: CreateParams): Promise<PlatformApiKeyWithValue> {
        const value = `${PLATFORM_API_KEY_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`
        const now = new Date().toISOString()
        const saved = await platformApiKeyRepo().save({
            id: apId(),
            created: now,
            updated: now,
            platformId,
            displayName,
            hashedValue: hashApiKey({ value }),
            truncatedValue: value.slice(-PLATFORM_API_KEY_TRUNCATED_LENGTH),
            lastUsedAt: null,
        })
        return { ...withoutSensitiveData(saved), value }
    },

    async list({ platformId }: ListParams): Promise<SeekPage<PlatformApiKey>> {
        const keys = await platformApiKeyRepo().findBy({ platformId })
        return {
            data: keys.map(withoutSensitiveData),
            next: null,
            previous: null,
        }
    },

    async delete({ id, platformId }: DeleteParams): Promise<void> {
        const result = await platformApiKeyRepo().delete({ id, platformId })
        if (result.affected === 0) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'platform_api_key', entityId: id },
            })
        }
    },

    async getByValue({ value }: GetByValueParams): Promise<PlatformApiKey | null> {
        if (!value.startsWith(PLATFORM_API_KEY_PREFIX)) {
            return null
        }
        const key = await platformApiKeyRepo().findOneBy({ hashedValue: hashApiKey({ value }) })
        if (isNil(key)) {
            return null
        }
        await platformApiKeyRepo().update({ id: key.id }, { lastUsedAt: new Date().toISOString() })
        return withoutSensitiveData(key)
    },
})

function hashApiKey({ value }: { value: string }): string {
    return createHash('sha256').update(value).digest('hex')
}

function withoutSensitiveData(key: PlatformApiKey & { hashedValue: string }): PlatformApiKey {
    const { hashedValue: _hashedValue, ...rest } = key
    return rest
}

type CreateParams = {
    platformId: string
    displayName: string
}

type ListParams = {
    platformId: string
}

type DeleteParams = {
    id: string
    platformId: string
}

type GetByValueParams = {
    value: string
}

type PlatformApiKeyService = {
    create(params: CreateParams): Promise<PlatformApiKeyWithValue>
    list(params: ListParams): Promise<SeekPage<PlatformApiKey>>
    delete(params: DeleteParams): Promise<void>
    getByValue(params: GetByValueParams): Promise<PlatformApiKey | null>
}
