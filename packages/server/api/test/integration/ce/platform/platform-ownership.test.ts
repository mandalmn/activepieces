import { PlatformRole, PrincipalType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { platformRepo } from '../../../../src/app/platform/platform.service'
import { userRepo } from '../../../../src/app/user/user-service'
import { projectRepo } from '../../../../src/app/project/project-repo'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { createMockUser, createMockUserIdentity } from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function addUser(platformId: string, platformRole: PlatformRole): Promise<string> {
    const identity = createMockUserIdentity({ verified: true })
    await db.save('user_identity', identity)
    const user = createMockUser({ platformId, platformRole, identityId: identity.id })
    await db.save('user', user)
    return user.id
}

async function transferAs(token: string, platformId: string, newOwnerId: string) {
    return app!.inject({
        method: 'POST',
        url: `/api/v1/platforms/${platformId}/transfer-ownership`,
        headers: { authorization: `Bearer ${token}` },
        body: { newOwnerId },
    })
}

describe('Platform ownership transfer', () => {
    it('moves ownership to another admin on the same platform', async () => {
        const ctx = await createTestContext(app!)
        const newOwnerId = await addUser(ctx.platform.id, PlatformRole.ADMIN)

        const response = await transferAs(ctx.token, ctx.platform.id, newOwnerId)

        expect(response.statusCode).toBe(StatusCodes.NO_CONTENT)
        const platform = await platformRepo().findOneByOrFail({ id: ctx.platform.id })
        expect(platform.ownerId).toBe(newOwnerId)
        const movedProject = await projectRepo().findOneByOrFail({ id: ctx.project.id })
        expect(movedProject.ownerId).toBe(newOwnerId)
    })

    it('refuses to hand ownership to a non-admin', async () => {
        const ctx = await createTestContext(app!)
        const memberId = await addUser(ctx.platform.id, PlatformRole.MEMBER)

        const response = await transferAs(ctx.token, ctx.platform.id, memberId)

        expect(response.statusCode).toBe(StatusCodes.CONFLICT)
        const platform = await platformRepo().findOneByOrFail({ id: ctx.platform.id })
        expect(platform.ownerId).toBe(ctx.user.id)
    })

    it('refuses to hand ownership to a user on another platform', async () => {
        const owner = await createTestContext(app!)
        const stranger = await createTestContext(app!)

        const response = await transferAs(owner.token, owner.platform.id, stranger.user.id)

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        const platform = await platformRepo().findOneByOrFail({ id: owner.platform.id })
        expect(platform.ownerId).toBe(owner.user.id)
    })

    it('refuses when the caller is not the current owner', async () => {
        const ctx = await createTestContext(app!)
        const otherAdminId = await addUser(ctx.platform.id, PlatformRole.ADMIN)
        const otherAdminToken = await generateMockToken({
            id: otherAdminId,
            type: PrincipalType.USER,
            platform: { id: ctx.platform.id },
        })

        const response = await transferAs(otherAdminToken, ctx.platform.id, otherAdminId)

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        const platform = await platformRepo().findOneByOrFail({ id: ctx.platform.id })
        expect(platform.ownerId).toBe(ctx.user.id)
    })

    it('lets the previous owner be deleted afterwards', async () => {
        const ctx = await createTestContext(app!)
        const newOwnerId = await addUser(ctx.platform.id, PlatformRole.ADMIN)
        await transferAs(ctx.token, ctx.platform.id, newOwnerId)

        const newOwnerToken = await generateMockToken({
            id: newOwnerId,
            type: PrincipalType.USER,
            platform: { id: ctx.platform.id },
        })
        const deleted = await app!.inject({
            method: 'DELETE',
            url: `/api/v1/users/${ctx.user.id}`,
            headers: { authorization: `Bearer ${newOwnerToken}` },
        })

        expect(deleted.statusCode).toBe(StatusCodes.NO_CONTENT)
        const gone = await userRepo().findOneBy({ id: ctx.user.id })
        expect(gone).toBeNull()
    })
})
