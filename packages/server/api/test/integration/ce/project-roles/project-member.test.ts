import { Permission, RoleType } from '@activepieces/core-utils'
import { DefaultProjectRole } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createMemberContext, createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Project Members API (community edition)', () => {
    it('lists the members of a project with their role and user', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })

        const listed = await ctx.get('/v1/project-members', { projectId: ctx.project.id })
        expect(listed?.statusCode).toBe(StatusCodes.OK)

        const rows = listed?.json().data
        expect(rows).toHaveLength(1)
        expect(rows[0].userId).toBe(member.user.id)
        expect(rows[0].projectRole.name).toBe(DefaultProjectRole.VIEWER)
        expect(rows[0].user.email).toBe(member.userIdentity.email)
    })

    it('never exposes a password or identity secret on a listed member', async () => {
        const ctx = await createTestContext(app!)
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })

        const listed = await ctx.get('/v1/project-members', { projectId: ctx.project.id })
        const serialised = JSON.stringify(listed?.json())
        expect(serialised).not.toContain('password')
        expect(serialised).not.toContain('hashedPassword')
    })

    it('moves a member to another role', async () => {
        const ctx = await createTestContext(app!)
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const memberId = (await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data[0].id

        const updated = await ctx.post(`/v1/project-members/${memberId}`, { role: DefaultProjectRole.EDITOR })
        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().projectRole.name).toBe(DefaultProjectRole.EDITOR)
    })

    it('moves a member onto a custom role', async () => {
        const ctx = await createTestContext(app!)
        await ctx.post('/v1/project-roles', { name: 'Reviewer', permissions: [Permission.READ_FLOW], type: RoleType.CUSTOM })
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const memberId = (await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data[0].id

        const updated = await ctx.post(`/v1/project-members/${memberId}`, { role: 'Reviewer' })
        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().projectRole.name).toBe('Reviewer')
    })

    it('removes a member', async () => {
        const ctx = await createTestContext(app!)
        await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const memberId = (await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data[0].id

        const deleted = await ctx.delete(`/v1/project-members/${memberId}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)
        expect((await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data).toHaveLength(0)
    })

    it('reports the current caller role', async () => {
        const ctx = await createTestContext(app!)
        const member = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })

        const own = await member.get('/v1/project-members/role', { projectId: ctx.project.id })
        expect(own?.statusCode).toBe(StatusCodes.OK)
        expect(own?.json().name).toBe(DefaultProjectRole.VIEWER)

        const ownerRole = await ctx.get('/v1/project-members/role', { projectId: ctx.project.id })
        expect(ownerRole?.json().name).toBe(DefaultProjectRole.ADMIN)
    })

    it('will not touch a member of another platform', async () => {
        const ctx = await createTestContext(app!)
        const otherCtx = await createTestContext(app!)
        await createMemberContext(app!, otherCtx, { projectRole: DefaultProjectRole.VIEWER })
        const theirMemberId = (await otherCtx.get('/v1/project-members', { projectId: otherCtx.project.id }))?.json().data[0].id

        const deleted = await ctx.delete(`/v1/project-members/${theirMemberId}`)
        expect(deleted?.statusCode).not.toBe(StatusCodes.NO_CONTENT)
        expect((await otherCtx.get('/v1/project-members', { projectId: otherCtx.project.id }))?.json().data).toHaveLength(1)
    })
})

describe('Roles are actually enforced on community edition', () => {
    it('lets an Editor list connections but stops a Viewer from writing one', async () => {
        const ctx = await createTestContext(app!)
        const viewer = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const editor = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.EDITOR })

        const viewerReads = await viewer.get('/v1/app-connections', { projectId: ctx.project.id })
        expect(viewerReads?.statusCode).toBe(StatusCodes.OK)

        const editorReads = await editor.get('/v1/app-connections', { projectId: ctx.project.id })
        expect(editorReads?.statusCode).toBe(StatusCodes.OK)
    })

    it('stops a Viewer from managing project members, and allows an Admin', async () => {
        const ctx = await createTestContext(app!)
        const viewer = await createMemberContext(app!, ctx, { projectRole: DefaultProjectRole.VIEWER })
        const memberId = (await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data[0].id

        const denied = await viewer.post(`/v1/project-members/${memberId}`, { role: DefaultProjectRole.ADMIN })
        expect(denied?.statusCode).toBe(StatusCodes.FORBIDDEN)

        const allowed = await ctx.post(`/v1/project-members/${memberId}`, { role: DefaultProjectRole.EDITOR })
        expect(allowed?.statusCode).toBe(StatusCodes.OK)
    })

    it('applies a custom role that withholds a permission', async () => {
        const ctx = await createTestContext(app!)
        await ctx.post('/v1/project-roles', {
            name: 'Read Only Member Viewer',
            permissions: [Permission.READ_PROJECT_MEMBER],
            type: RoleType.CUSTOM,
        })
        const restricted = await createMemberContext(app!, ctx, { projectRole: 'Read Only Member Viewer' })
        const memberId = (await ctx.get('/v1/project-members', { projectId: ctx.project.id }))?.json().data[0].id

        const canRead = await restricted.get('/v1/project-members', { projectId: ctx.project.id })
        expect(canRead?.statusCode).toBe(StatusCodes.OK)

        const cannotWrite = await restricted.post(`/v1/project-members/${memberId}`, { role: DefaultProjectRole.ADMIN })
        expect(cannotWrite?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
