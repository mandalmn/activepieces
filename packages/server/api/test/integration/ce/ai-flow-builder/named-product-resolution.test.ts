import {
    ToolResolutionStatus,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const SALESFORCE = '@activepieces/piece-salesforce'
const CAPSULE = '@activepieces/piece-capsule-crm'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function seeded(): Promise<TestContext> {
    const ctx = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    return ctx
}

function planWith({ product }: { product: string | null }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Sales summary',
        description: 'Pull sales records and mail a summary',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 9',
            service: null,
            product: null,
            schedule: { cronExpression: '0 9 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 09:00' },
        },
        steps: [
            {
                id: 'step_1',
                dependsOn: [],
                kind: WorkflowStepKind.FETCH,
                summary: 'Retrieve the sales records for MCS LLC',
                service: 'customer relationship management',
                product,
            },
        ],
    }
}

async function resolve({ ctx, plan }: { ctx: TestContext, plan: unknown }) {
    const response = await ctx.post('/v1/ai-flow-builder/resolve', { projectId: ctx.project.id, plan })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

describe('A product the person named', () => {
    it('is chosen over another app in the same category', async () => {
        const ctx = await seeded()

        const body = await resolve({ ctx, plan: planWith({ product: 'salesforce' }) })

        const step = body.plan.steps[0]
        expect(step.status).toBe(ToolResolutionStatus.RESOLVED)
        expect(step.tool.pieceName).toBe(SALESFORCE)
    })

    it('does not pin any CRM when the person named none', async () => {
        const ctx = await seeded()

        const body = await resolve({ ctx, plan: planWith({ product: null }) })

        const step = body.plan.steps[0]
        expect(step.tool?.pieceName).not.toBe(SALESFORCE)
        expect(step.tool?.pieceName).not.toBe(CAPSULE)
    })

    it('does not pin a product that is not installed', async () => {
        const ctx = await seeded()

        const body = await resolve({ ctx, plan: planWith({ product: 'zoho' }) })

        const step = body.plan.steps[0]
        expect(step.tool?.pieceName).not.toBe(SALESFORCE)
        expect(step.tool?.pieceName).not.toBe(CAPSULE)
    })
})
