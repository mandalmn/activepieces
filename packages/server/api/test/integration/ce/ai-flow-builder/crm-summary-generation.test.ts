import {
    AiFlowGenerationStatus,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const salesSummaryPlan = {
    version: WORKFLOW_PLAN_VERSION,
    name: 'MCS LLC Sales Summary',
    description: 'Generates and delivers a periodic sales summary report from CRM sales records.',
    trigger: {
        kind: WorkflowTriggerKind.SCHEDULE,
        summary: 'Runs every Monday morning to produce the weekly sales summary',
        service: null,
        schedule: { cronExpression: '0 9 * * 1', timezone: 'Asia/Ulaanbaatar', description: 'Every Monday at 9:00 AM' },
    },
    steps: [
        { id: 'step_1', dependsOn: [], kind: WorkflowStepKind.FETCH, summary: 'Retrieve deals, closed sales, and pipeline data from the CRM', service: 'customer relationship management' },
        { id: 'step_2', dependsOn: ['step_1'], kind: WorkflowStepKind.TRANSFORM, summary: 'Calculate total revenue, win rates, average deal size, and pipeline totals', service: null },
        { id: 'step_3', dependsOn: ['step_2'], kind: WorkflowStepKind.TRANSFORM, summary: 'Format the aggregated sales metrics into a structured summary report', service: null },
        { id: 'step_4', dependsOn: ['step_3'], kind: WorkflowStepKind.OUTPUT, summary: 'Log the weekly sales summary data into a reporting spreadsheet', service: 'spreadsheet' },
        { id: 'step_5', dependsOn: ['step_4'], kind: WorkflowStepKind.OUTPUT, summary: 'Send the formatted sales summary report to stakeholders via email', service: 'email' },
    ],
}

describe('Generating a multi-step CRM summary', () => {
    it('builds a flow from a plan whose services have no matching piece', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })

        const response = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'make me MCS LLC sales summary from salesforce sales data',
            plan: salesSummaryPlan,
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json()
        expect(body.status).toBe(AiFlowGenerationStatus.DRAFTED)
        expect(body.flowId).toEqual(expect.any(String))
    })

    it('rejects a plan whose steps are missing dependsOn rather than failing later', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })

        const withoutDependsOn = {
            ...salesSummaryPlan,
            steps: salesSummaryPlan.steps.map(({ dependsOn: _dependsOn, ...rest }) => rest),
        }
        const response = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'make me MCS LLC sales summary from salesforce sales data',
            plan: withoutDependsOn,
        })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })
})
