import { WorkflowPlanStatus } from '@activepieces/shared'
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

describe('Workflow planner endpoint', () => {
    it('reports UNAVAILABLE rather than failing when no AI provider is configured', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/ai-flow-builder/plan', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send me the gold price change',
            timezone: 'Asia/Ulaanbaatar',
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json()
        expect(body.status).toBe(WorkflowPlanStatus.UNAVAILABLE)
        expect(body.plan).toBeNull()
        expect(body.issues.length).toBeGreaterThan(0)
    })

    it('rejects an empty prompt', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/ai-flow-builder/plan', {
            projectId: ctx.project.id,
            prompt: '   ',
        })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })

    it('accepts a request without a timezone', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/ai-flow-builder/plan', {
            projectId: ctx.project.id,
            prompt: 'Every Monday at 9 email me a summary',
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
    })

    it('refuses a project on another platform', async () => {
        const owner = await createTestContext(app!)
        const stranger = await createTestContext(app!)

        const response = await owner.post('/v1/ai-flow-builder/plan', {
            projectId: stranger.project.id,
            prompt: 'Every day at 7 AM send a message',
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
