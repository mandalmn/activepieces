import { DefaultProjectRole, SecretManagerConnectionScope, SecretManagerProviderId } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createMemberContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const verify = vi.fn()

vi.mock('../../../../src/app/secret-managers/providers', () => ({
    secretManagerProviders: {
        verify: (params: unknown) => verify(params),
        fetch: vi.fn().mockResolvedValue('resolved-secret'),
    },
}))

let app: FastifyInstance | null = null

const vaultRequest = (name: string) => ({
    name,
    scope: SecretManagerConnectionScope.PLATFORM,
    providerId: SecretManagerProviderId.HASHICORP,
    config: {
        url: 'https://vault.internal',
        roleId: 'role-id',
        secretId: 'secret-id',
    },
})

beforeAll(async () => {
    app = await setupTestEnvironment()
})

beforeEach(() => {
    verify.mockReset()
    verify.mockResolvedValue(undefined)
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Secret Managers API (community edition)', () => {
    it('creates a connection without ever echoing the credentials back', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/secret-managers', vaultRequest('prod vault'))
        expect(created?.statusCode).toBe(StatusCodes.CREATED)

        const body = created?.json()
        expect(body.name).toBe('prod vault')
        expect(body.providerId).toBe(SecretManagerProviderId.HASHICORP)
        expect(body.connection).toEqual({ configured: true, connected: true })

        const serialised = JSON.stringify(body)
        expect(serialised).not.toContain('role-id')
        expect(serialised).not.toContain('secret-id')
        expect(body.auth).toBeUndefined()
        expect(body.config).toBeUndefined()
    })

    it('verifies the vault is reachable before storing anything', async () => {
        const ctx = await createTestContext(app!)
        verify.mockRejectedValue(new Error('vault unreachable'))

        const created = await ctx.post('/v1/secret-managers', vaultRequest('unreachable vault'))
        expect(created?.statusCode).not.toBe(StatusCodes.CREATED)

        const listed = await ctx.get('/v1/secret-managers')
        expect(listed?.json().data).toHaveLength(0)
    })

    it('lists only the connections belonging to the caller platform', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)

        await ctx.post('/v1/secret-managers', vaultRequest('mine'))
        await otherCtx.post('/v1/secret-managers', vaultRequest('theirs'))

        const listed = await ctx.get('/v1/secret-managers')
        const names = listed?.json().data.map((row: { name: string }) => row.name)
        expect(names).toEqual(['mine'])
    })

    it('updates a connection in place', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/secret-managers', vaultRequest('before'))
        const id = created?.json().id

        const updated = await ctx.post(`/v1/secret-managers/${id}`, vaultRequest('after'))
        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().name).toBe('after')
        expect(updated?.json().id).toBe(id)
    })

    it('deletes a connection', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/secret-managers', vaultRequest('doomed'))
        const id = created?.json().id

        const deleted = await ctx.delete(`/v1/secret-managers/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect((await ctx.get('/v1/secret-managers'))?.json().data).toHaveLength(0)
    })

    it('will not touch a connection owned by another platform', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)
        const created = await otherCtx.post('/v1/secret-managers', vaultRequest('theirs'))
        const id = created?.json().id

        const deleted = await ctx.delete(`/v1/secret-managers/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NOT_FOUND)
        expect((await otherCtx.get('/v1/secret-managers'))?.json().data).toHaveLength(1)
    })

    it('stops a non-admin from listing across the whole platform', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.ADMIN })

        const listed = await member.get('/v1/secret-managers')
        expect(listed?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('lets a project member list what is shared with their project', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.ADMIN })

        await ctx.post('/v1/secret-managers', {
            ...vaultRequest('shared vault'),
            scope: SecretManagerConnectionScope.PROJECT,
            projectIds: [ctx.project.id],
        })
        await ctx.post('/v1/secret-managers', vaultRequest('platform vault'))

        const listed = await member.get(`/v1/secret-managers?projectId=${ctx.project.id}`)
        expect(listed?.statusCode).toBe(StatusCodes.OK)
        const names = listed?.json().data.map((row: { name: string }) => row.name).sort()
        expect(names).toEqual(['platform vault', 'shared vault'])
    })

    it('stops a non-admin from creating a connection', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.ADMIN })

        const created = await member.post('/v1/secret-managers', vaultRequest('sneaky'))
        expect(created?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
