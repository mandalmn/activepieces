import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const axiosRequest = vi.fn()

vi.mock('@activepieces/server-utils', () => ({
    safeHttp: {
        get axios() {
            return { request: axiosRequest }
        },
    },
}))

const { hashicorpVaultProvider } = await import('../../../../src/app/secret-managers/providers/hashicorp-vault-provider')

const config = {
    url: 'https://vault.internal/',
    roleId: 'role-id',
    secretId: 'secret-id',
}

const loginResponse = { data: { auth: { client_token: 'vault-token' } } }

async function failureOf(promise: Promise<unknown>): Promise<{ code: string, message: string }> {
    try {
        await promise
        throw new Error('expected the call to fail')
    }
    catch (error) {
        const { code, params } = (error as ActivepiecesError).error
        return { code, message: String((params as { message: string }).message) }
    }
}

beforeEach(() => {
    axiosRequest.mockReset()
})

describe('hashicorpVaultProvider.fetch', () => {
    it('logs in with AppRole, then reads the key out of a KV v2 secret', async () => {
        axiosRequest
            .mockResolvedValueOnce(loginResponse)
            .mockResolvedValueOnce({ data: { data: { data: { 'api-key': 'super-secret' } } } })

        const secret = await hashicorpVaultProvider.fetch({ config, path: 'secret/data/keys/api-key' })

        expect(secret).toBe('super-secret')
        expect(axiosRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
            method: 'POST',
            url: 'https://vault.internal/v1/auth/approle/login',
            data: { role_id: 'role-id', secret_id: 'secret-id' },
        }))
        expect(axiosRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'GET',
            url: 'https://vault.internal/v1/secret/data/keys',
            headers: expect.objectContaining({ 'X-Vault-Token': 'vault-token' }),
        }))
    })

    it('sends the namespace header when one is configured', async () => {
        axiosRequest
            .mockResolvedValueOnce(loginResponse)
            .mockResolvedValueOnce({ data: { data: { data: { k: 'v' } } } })

        await hashicorpVaultProvider.fetch({ config: { ...config, namespace: 'team-a' }, path: 'secret/data/x/k' })

        expect(axiosRequest.mock.calls.every(([options]) => options.headers['X-Vault-Namespace'] === 'team-a')).toBe(true)
    })

    it('omits the namespace header when none is configured', async () => {
        axiosRequest
            .mockResolvedValueOnce(loginResponse)
            .mockResolvedValueOnce({ data: { data: { data: { k: 'v' } } } })

        await hashicorpVaultProvider.fetch({ config, path: 'secret/data/x/k' })

        expect(axiosRequest.mock.calls.every(([options]) => !('X-Vault-Namespace' in options.headers))).toBe(true)
    })

    it('fails clearly when the key is absent from the secret', async () => {
        axiosRequest
            .mockResolvedValueOnce(loginResponse)
            .mockResolvedValueOnce({ data: { data: { data: { other: 'v' } } } })

        const failure = await failureOf(hashicorpVaultProvider.fetch({ config, path: 'secret/data/x/missing' }))
        expect(failure.code).toBe(ErrorCode.SECRET_MANAGER_GET_SECRET_FAILED)
        expect(failure.message).toContain('missing')
    })

    it('rejects a path that names no key', async () => {
        axiosRequest.mockResolvedValueOnce(loginResponse)

        const failure = await failureOf(hashicorpVaultProvider.fetch({ config, path: 'secret' }))
        expect(failure.code).toBe(ErrorCode.SECRET_MANAGER_GET_SECRET_FAILED)
        expect(failure.message).toContain('secret/data/my-secret/my-key')
    })

    it('fails when the AppRole login returns no token', async () => {
        axiosRequest.mockResolvedValueOnce({ data: { auth: {} } })

        const failure = await failureOf(hashicorpVaultProvider.fetch({ config, path: 'secret/data/x/k' }))
        expect(failure.code).toBe(ErrorCode.SECRET_MANAGER_GET_SECRET_FAILED)
        expect(failure.message).toContain('client token')
    })
})

describe('hashicorpVaultProvider.verify', () => {
    it('passes when the AppRole login succeeds', async () => {
        axiosRequest.mockResolvedValueOnce(loginResponse)
        await expect(hashicorpVaultProvider.verify({ config })).resolves.toBeUndefined()
    })

    it('fails when the vault cannot be reached', async () => {
        axiosRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        const failure = await failureOf(hashicorpVaultProvider.verify({ config }))
        expect(failure.code).toBe(ErrorCode.SECRET_MANAGER_CONNECTION_FAILED)
        expect(failure.message).toContain('ECONNREFUSED')
    })
})
