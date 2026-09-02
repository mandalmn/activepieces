import { Permission, RoleType } from '@activepieces/core-utils'
import { DefaultProjectRole } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createMemberContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

const customRole = (name: string, permissions: Permission[] = [Permission.READ_FLOW]) => ({
    name,
    permissions,
    type: RoleType.CUSTOM,
})

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Project Roles API (community edition)', () => {
    it('lists the three built-in roles', async () => {
        const ctx = await createTestContext(app!)

        const listed = await ctx.get('/v1/project-roles')
        expect(listed?.statusCode).toBe(StatusCodes.OK)

        const names = listed?.json().data.map((role: { name: string }) => role.name)
        expect(names).toEqual(
            expect.arrayContaining([DefaultProjectRole.ADMIN, DefaultProjectRole.EDITOR, DefaultProjectRole.VIEWER]),
        )
    })

    it('creates a custom role and lists it alongside the built-in ones', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/project-roles', customRole('Auditor'))
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        expect(created?.json().type).toBe(RoleType.CUSTOM)
        expect(created?.json().platformId).toBe(ctx.platform.id)

        const names = (await ctx.get('/v1/project-roles'))?.json().data.map((role: { name: string }) => role.name)
        expect(names).toContain('Auditor')
    })

    it('refuses a name that is already taken, in any casing', async () => {
        const ctx = await createTestContext(app!)
        await ctx.post('/v1/project-roles', customRole('Duplicate Check'))

        const duplicate = await ctx.post('/v1/project-roles', customRole('duplicate check'))
        expect(duplicate?.statusCode).not.toBe(StatusCodes.CREATED)
    })

    it('refuses to shadow a built-in role name', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/project-roles', customRole(DefaultProjectRole.VIEWER))
        expect(created?.statusCode).not.toBe(StatusCodes.CREATED)
    })

    it('updates a custom role', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/project-roles', customRole('Renamable'))
        const id = created?.json().id

        const updated = await ctx.post(`/v1/project-roles/${id}`, {
            name: 'Senior Auditor',
            permissions: [Permission.READ_FLOW, Permission.READ_RUN],
        })
        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().name).toBe('Senior Auditor')
        expect(updated?.json().permissions).toEqual([Permission.READ_FLOW, Permission.READ_RUN])
    })

    it('deletes a custom role', async () => {
        const ctx = await createTestContext(app!)
        await ctx.post('/v1/project-roles', customRole('Disposable'))

        const deleted = await ctx.delete('/v1/project-roles/Disposable')
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const names = (await ctx.get('/v1/project-roles'))?.json().data.map((role: { name: string }) => role.name)
        expect(names).not.toContain('Disposable')
    })

    it('will not let a built-in role be edited or deleted', async () => {
        const ctx = await createTestContext(app!)
        const roles = (await ctx.get('/v1/project-roles'))?.json().data
        const viewer = roles.find((role: { name: string }) => role.name === DefaultProjectRole.VIEWER)

        const updated = await ctx.post(`/v1/project-roles/${viewer.id}`, { permissions: [Permission.WRITE_FLOW] })
        expect(updated?.statusCode).not.toBe(StatusCodes.OK)

        const deleted = await ctx.delete(`/v1/project-roles/${DefaultProjectRole.VIEWER}`)
        expect(deleted?.statusCode).not.toBe(StatusCodes.NO_CONTENT)
    })

    it('will not delete a role that members are still assigned to', async () => {
        const ctx = await createTestContext(app!)
        await ctx.post('/v1/project-roles', customRole('Occupied'))
        await createMemberContext(app!, ctx, { projectRole: 'Occupied' })

        const deleted = await ctx.delete('/v1/project-roles/Occupied')
        expect(deleted?.statusCode).not.toBe(StatusCodes.NO_CONTENT)

        const names = (await ctx.get('/v1/project-roles'))?.json().data.map((role: { name: string }) => role.name)
        expect(names).toContain('Occupied')
    })

    it('counts the members assigned to each role', async () => {
        const ctx = await createTestContext(app!)
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.EDITOR })

        const roles = (await ctx.get('/v1/project-roles'))?.json().data
        const countOf = (name: string) => roles.find((role: { name: string }) => role.name === name).userCount
        expect(countOf(DefaultProjectRole.VIEWER)).toBe(2)
        expect(countOf(DefaultProjectRole.EDITOR)).toBe(1)
        expect(countOf(DefaultProjectRole.ADMIN)).toBe(0)
    })

    it('lists the members holding a role', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const roles = (await ctx.get('/v1/project-roles'))?.json().data
        const viewer = roles.find((role: { name: string }) => role.name === DefaultProjectRole.VIEWER)

        const listed = await ctx.get(`/v1/project-roles/${viewer.id}/project-members`)
        expect(listed?.statusCode).toBe(StatusCodes.OK)
        const userIds = listed?.json().data.map((row: { userId: string }) => row.userId)
        expect(userIds).toEqual([member.user.id])
    })

    it('never leaks roles belonging to another platform', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)
        await otherCtx.post('/v1/project-roles', customRole('Their Role'))

        const names = (await ctx.get('/v1/project-roles'))?.json().data.map((role: { name: string }) => role.name)
        expect(names).not.toContain('Their Role')
    })

    it('will not read a role belonging to another platform by id', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)
        const theirs = await otherCtx.post('/v1/project-roles', customRole('Their Secret Role'))
        const theirId = theirs?.json().id

        const read = await ctx.get(`/v1/project-roles/${theirId}`)
        expect(read?.statusCode).toBe(StatusCodes.NOT_FOUND)

        const members = await ctx.get(`/v1/project-roles/${theirId}/project-members`)
        expect(members?.statusCode).toBe(StatusCodes.NOT_FOUND)

        const hijack = await ctx.post(`/v1/project-roles/${theirId}`, { name: 'Hijacked' })
        expect(hijack?.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('still reads a built-in role by id, which every platform shares', async () => {
        const ctx = await createTestContext(app!)
        const roles = (await ctx.get('/v1/project-roles'))?.json().data
        const admin = roles.find((role: { name: string }) => role.name === DefaultProjectRole.ADMIN)

        const read = await ctx.get(`/v1/project-roles/${admin.id}`)
        expect(read?.statusCode).toBe(StatusCodes.OK)
        expect(read?.json().name).toBe(DefaultProjectRole.ADMIN)
    })

    it('refuses to store a permission that does not exist', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/project-roles', {
            name: 'Bogus',
            permissions: ['READ_FLOW', 'NOT_A_REAL_PERMISSION'],
            type: RoleType.CUSTOM,
        })
        expect(created?.statusCode).not.toBe(StatusCodes.CREATED)
    })

    it('always stores a new role as custom, even when asked for a built-in one', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/project-roles', {
            name: 'Pretender',
            permissions: [Permission.READ_FLOW],
            type: RoleType.DEFAULT,
        })
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        expect(created?.json().type).toBe(RoleType.CUSTOM)

        const deleted = await ctx.delete('/v1/project-roles/Pretender')
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)
    })

    it('stops a non-admin from creating a role', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.ADMIN })

        const created = await member.post('/v1/project-roles', customRole('Sneaky'))
        expect(created?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
