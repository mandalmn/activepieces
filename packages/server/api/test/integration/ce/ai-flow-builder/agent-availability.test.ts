import { WORKFLOW_PLAN_VERSION, WorkflowStepKind, WorkflowTriggerKind } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const AGENT_PIECE = '@activepieces/piece-agentrunner'

let app: FastifyInstance | null = null
let previousAgentsEnabled: string | undefined

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(() => {
    previousAgentsEnabled = process.env.AP_AGENTS_ENABLED
})

afterEach(() => {
    if (previousAgentsEnabled === undefined) {
        delete process.env.AP_AGENTS_ENABLED
        return
    }
    process.env.AP_AGENTS_ENABLED = previousAgentsEnabled
})

const agentShapedPlan = {
    version: WORKFLOW_PLAN_VERSION,
    name: 'Scrape and summarise',
    description: 'Read a page and summarise it',
    trigger: {
        kind: WorkflowTriggerKind.SCHEDULE,
        summary: 'Every morning',
        service: null,
        product: null,
        schedule: { cronExpression: '0 9 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every morning' },
    },
    steps: [
        {
            id: 'step_1',
            dependsOn: [],
            kind: WorkflowStepKind.OUTPUT,
            summary: 'Reason over a web page and pull out the latest tenders, using tools as needed',
            service: null,
            product: 'agent runner',
        },
    ],
}

async function resolveWith({ agentsEnabled }: { agentsEnabled: boolean }): Promise<string | null> {
    process.env.AP_AGENTS_ENABLED = String(agentsEnabled)
    const ctx: TestContext = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    const response = await ctx.post('/v1/ai-flow-builder/resolve', { projectId: ctx.project.id, plan: agentShapedPlan })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json().plan.steps[0].tool?.pieceName ?? null
}

describe('An agent step is only offered where the agent runtime exists', () => {
    it('never picks Run Agent when the agent runtime is off, even asked for by name', async () => {
        expect(await resolveWith({ agentsEnabled: false })).not.toBe(AGENT_PIECE)
    })

    it('picks it once the agent runtime is on', async () => {
        expect(await resolveWith({ agentsEnabled: true })).toBe(AGENT_PIECE)
    })

})
