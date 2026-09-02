import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Platform API Key API', () => {
    it('returns the secret exactly once on creation', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/api-keys', { displayName: 'ci key' })
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const body = created?.json()
        expect(body.value).toMatch(/^sk-/)
        expect(body.displayName).toBe('ci key')
        expect(body.hashedValue).toBeUndefined()

        const listed = await ctx.get('/v1/api-keys')
        const row = listed?.json().data.find((key: { id: string }) => key.id === body.id)
        expect(row.value).toBeUndefined()
        expect(row.hashedValue).toBeUndefined()
        expect(row.truncatedValue).toBe(body.value.slice(-8))
    })

    it('authenticates a request with the issued key', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/api-keys', { displayName: 'auth key' })
        const value = created?.json().value

        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/api-keys',
            headers: { authorization: `Bearer ${value}` },
        })

        expect(response.statusCode).not.toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects an unknown key', async () => {
        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/api-keys',
            headers: { authorization: 'Bearer sk-not-a-real-key' },
        })

        expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('revokes a key so it no longer authenticates', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/api-keys', { displayName: 'doomed key' })
        const { id, value } = created?.json()

        const deleted = await ctx.delete(`/v1/api-keys/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/api-keys',
            headers: { authorization: `Bearer ${value}` },
        })
        expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
    })

    it('rejects an empty display name', async () => {
        const ctx = await createTestContext(app!)
        const response = await ctx.post('/v1/api-keys', { displayName: '  ' })
        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })
})
