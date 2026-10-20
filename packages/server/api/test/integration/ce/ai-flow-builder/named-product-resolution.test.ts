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

describe('A whole request naming two different apps', () => {
    const outlookToTeams = {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Outlook to Teams',
        description: 'Read mail and post a summary',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every morning',
            service: null,
            product: null,
            schedule: { cronExpression: '0 9 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every morning' },
        },
        steps: [
            { id: 'step_1', dependsOn: [], kind: WorkflowStepKind.FETCH, summary: 'Read the emails that arrived in the mailbox', service: 'email', product: 'outlook' },
            { id: 'step_2', dependsOn: ['step_1'], kind: WorkflowStepKind.TRANSFORM, summary: 'Summarise the emails', service: null, product: null },
            { id: 'step_3', dependsOn: ['step_2'], kind: WorkflowStepKind.OUTPUT, summary: 'Send the summary to my colleagues in a chat channel', service: 'chat', product: 'teams' },
        ],
    }

    it('gives each step the app that step named, not a generic HTTP request', async () => {
        const ctx = await seeded()

        const body = await resolve({ ctx, plan: outlookToTeams })

        const [read, , deliver] = body.plan.steps
        expect(read.tool.pieceName).toBe('@activepieces/piece-microsoft-outlook')
        expect(deliver.tool.pieceName).toBe('@activepieces/piece-microsoft-teams')
    })

    it('still finds the app when the planner puts the product in the service field', async () => {
        const ctx = await seeded()

        const body = await resolve({
            ctx,
            plan: {
                ...outlookToTeams,
                steps: outlookToTeams.steps.map((step) => ({ ...step, service: step.product ?? step.service, product: null })),
            },
        })

        const [read, , deliver] = body.plan.steps
        expect(read.tool.pieceName).toBe('@activepieces/piece-microsoft-outlook')
        expect(deliver.tool.pieceName).toBe('@activepieces/piece-microsoft-teams')
    })
})
