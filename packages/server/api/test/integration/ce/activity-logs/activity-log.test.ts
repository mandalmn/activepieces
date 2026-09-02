import { ActivityLog } from '@activepieces/shared'
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

async function waitForAction(ctx: Awaited<ReturnType<typeof createTestContext>>, action: string): Promise<ActivityLog | undefined> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const response = await ctx.get('/v1/activity-logs', { limit: 100 })
        const rows: ActivityLog[] = response?.json().data ?? []
        const match = rows.find((row) => row.action === action)
        if (match !== undefined) {
            return match
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return undefined
}

describe('Activity Log API', () => {
    it('records a flow creation performed through the API', async () => {
        const ctx = await createTestContext(app!)

        await ctx.post('/v1/flows', {
            displayName: 'audited flow',
            projectId: ctx.project.id,
        }, { query: { projectId: ctx.project.id } })

        const entry = await waitForAction(ctx, 'flow.created')

        expect(entry).toBeDefined()
        expect(entry?.platformId).toBe(ctx.platform.id)
        expect(entry?.projectId).toBe(ctx.project.id)
        expect(entry?.userEmail).toBe(ctx.userIdentity.email)
    })

    it('returns newest first and paginates with a cursor', async () => {
        const ctx = await createTestContext(app!)

        for (const displayName of ['one', 'two', 'three']) {
            await ctx.post('/v1/flows', {
                displayName,
                projectId: ctx.project.id,
            }, { query: { projectId: ctx.project.id } })
        }
        await waitForAction(ctx, 'flow.created')

        const firstPage = await ctx.get('/v1/activity-logs', { limit: 1 })
        expect(firstPage?.statusCode).toBe(StatusCodes.OK)
        const firstBody = firstPage?.json()
        expect(firstBody.data).toHaveLength(1)
        expect(firstBody.next).not.toBeNull()

        const secondPage = await ctx.get('/v1/activity-logs', { limit: 1, cursor: firstBody.next })
        const secondBody = secondPage?.json()
        expect(secondBody.data[0].id).not.toBe(firstBody.data[0].id)
        expect(new Date(secondBody.data[0].created).getTime())
            .toBeLessThanOrEqual(new Date(firstBody.data[0].created).getTime())
    })

    it('never leaks another platform activity', async () => {
        const first = await createTestContext(app!)
        const second = await createTestContext(app!)

        await first.post('/v1/flows', {
            displayName: 'first platform flow',
            projectId: first.project.id,
        }, { query: { projectId: first.project.id } })
        await waitForAction(first, 'flow.created')

        const response = await second.get('/v1/activity-logs', { limit: 100 })
        const rows: ActivityLog[] = response?.json().data ?? []

        expect(rows.every((row) => row.platformId === second.platform.id)).toBe(true)
    })
})
