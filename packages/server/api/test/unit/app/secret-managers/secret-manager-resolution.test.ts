import { SecretManagerFieldsSeparator } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findOneBy = vi.fn()
const fetchSecret = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({ findOneBy }),
}))

vi.mock('../../../../src/app/secret-managers/providers', () => ({
    secretManagerProviders: {
        fetch: (params: { path: string }) => fetchSecret(params),
        verify: vi.fn(),
    },
}))

vi.mock('../../../../src/app/secret-managers/secret-manager-cache', () => ({
    secretManagerCache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue(undefined),
        forget: vi.fn().mockResolvedValue(undefined),
    },
}))

vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: {
        decryptObject: vi.fn().mockResolvedValue({ url: 'https://vault.internal', roleId: 'r', secretId: 's' }),
        encryptObject: vi.fn(),
    },
    EncryptedObject: {},
}))

const { secretManagerService } = await import('../../../../src/app/secret-managers/secret-manager.service')

const log = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
const PLATFORM = 'platform-1'
const reference = `{{conn-1${SecretManagerFieldsSeparator}secret/data/keys/api-key}}`

beforeEach(() => {
    findOneBy.mockReset()
    fetchSecret.mockReset()
    findOneBy.mockResolvedValue({
        id: 'conn-1',
        platformId: PLATFORM,
        providerId: 'hashicorp',
        name: 'Vault',
        scope: 'PLATFORM',
        projectIds: null,
        auth: { iv: 'iv', data: 'data' },
    })
    fetchSecret.mockResolvedValue('resolved-secret')
})

describe('resolveObject', () => {
    it('leaves an ordinary connection value completely untouched', async () => {
        const value = { apiKey: 'hunter2', url: 'https://example.com', retries: 3, enabled: true }
        const resolved = await secretManagerService(log).resolveObject({ value, platformId: PLATFORM })

        expect(resolved).toEqual(value)
        expect(findOneBy).not.toHaveBeenCalled()
    })

    it('replaces only the fields that hold a reference', async () => {
        const resolved = await secretManagerService(log).resolveObject({
            value: { apiKey: reference, region: 'eu-west-1' },
            platformId: PLATFORM,
        })

        expect(resolved).toEqual({ apiKey: 'resolved-secret', region: 'eu-west-1' })
        expect(fetchSecret).toHaveBeenCalledWith({ credentials: expect.anything(), path: 'secret/data/keys/api-key' })
    })

    it('resolves references nested in objects and arrays', async () => {
        const resolved = await secretManagerService(log).resolveObject({
            value: { auth: { token: reference }, headers: ['plain', reference] },
            platformId: PLATFORM,
        })

        expect(resolved).toEqual({
            auth: { token: 'resolved-secret' },
            headers: ['plain', 'resolved-secret'],
        })
    })

    it('returns the original reference when the vault fails and throwOnFailure is false', async () => {
        fetchSecret.mockRejectedValue(new Error('vault unreachable'))

        const resolved = await secretManagerService(log).resolveObject({
            value: { apiKey: reference },
            platformId: PLATFORM,
            throwOnFailure: false,
        })

        expect(resolved).toEqual({ apiKey: reference })
    })

    it('throws when the vault fails and throwOnFailure is left at its default', async () => {
        fetchSecret.mockRejectedValue(new Error('vault unreachable'))

        await expect(secretManagerService(log).resolveObject({
            value: { apiKey: reference },
            platformId: PLATFORM,
        })).rejects.toThrow()
    })

    it('refuses a project-scoped connection that is not shared with the calling project', async () => {
        findOneBy.mockResolvedValue({
            id: 'conn-1',
            platformId: PLATFORM,
            providerId: 'hashicorp',
            name: 'Vault',
            scope: 'PROJECT',
            projectIds: ['project-allowed'],
            auth: { iv: 'iv', data: 'data' },
        })

        await expect(secretManagerService(log).resolveObject({
            value: { apiKey: reference },
            platformId: PLATFORM,
            projectIds: ['project-other'],
        })).rejects.toThrow()
        expect(fetchSecret).not.toHaveBeenCalled()
    })
})

describe('resolveString', () => {
    it('hands back a plain string unchanged', async () => {
        const resolved = await secretManagerService(log).resolveString({ key: 'not-a-reference', platformId: PLATFORM })
        expect(resolved).toBe('not-a-reference')
        expect(findOneBy).not.toHaveBeenCalled()
    })

    it('resolves a reference to the stored secret', async () => {
        const resolved = await secretManagerService(log).resolveString({ key: reference, platformId: PLATFORM })
        expect(resolved).toBe('resolved-secret')
    })
})
