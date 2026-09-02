import { isNil, tryCatch } from '@activepieces/core-utils'
import { FastifyBaseLogger } from 'fastify'
import { redisHelper } from '../database/redis'
import { distributedStore, redisConnections } from '../database/redis-connections'
import { EncryptedObject, encryptUtils } from '../helper/encryption'

const KEY_PREFIX = 'ce-secret-manager'
const TTL_SECONDS = 60 * 60

export const secretManagerCache = {
    async read({ platformId, connectionId, path, log }: ReadParams): Promise<string | null> {
        const { data } = await tryCatch(async () => {
            const stored = await distributedStore.get<EncryptedObject>(secretKey({ platformId, connectionId, path }))
            return isNil(stored) ? null : encryptUtils.decryptString(stored)
        })
        if (isNil(data)) {
            log.debug({ platform: { id: platformId }, connection: { id: connectionId } }, '[secretManager] Cache miss')
            return null
        }
        return data
    },

    async write({ platformId, connectionId, path, value, log }: WriteParams): Promise<void> {
        const { error } = await tryCatch(async () => {
            const encrypted = await encryptUtils.encryptString(value)
            await distributedStore.put(secretKey({ platformId, connectionId, path }), encrypted, TTL_SECONDS)
        })
        if (!isNil(error)) {
            log.debug({ platform: { id: platformId }, connection: { id: connectionId }, error }, '[secretManager] Could not cache a resolved secret')
        }
    },

    async forget({ platformId, connectionId, log }: ForgetParams): Promise<void> {
        const pattern = isNil(connectionId)
            ? `${KEY_PREFIX}:${platformId}:*`
            : `${KEY_PREFIX}:${platformId}:${connectionId}:*`
        const { error } = await tryCatch(async () => {
            const redis = await redisConnections.useExisting()
            const keys = await redisHelper.scanAll(redis, pattern)
            if (keys.length > 0) {
                await redis.del(keys)
            }
        })
        if (!isNil(error)) {
            log.debug({ platform: { id: platformId }, error }, '[secretManager] Could not clear the secret cache')
        }
    },
}

function secretKey({ platformId, connectionId, path }: { platformId: string, connectionId: string, path: string }): string {
    return `${KEY_PREFIX}:${platformId}:${connectionId}:${path}`
}

type ReadParams = {
    platformId: string
    connectionId: string
    path: string
    log: FastifyBaseLogger
}

type WriteParams = ReadParams & {
    value: string
}

type ForgetParams = {
    platformId: string
    connectionId?: string
    log: FastifyBaseLogger
}
