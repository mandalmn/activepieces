import { ToolResolutionConfidence, ToolResolutionStatus, WORKFLOW_PLAN_VERSION, WorkflowStepKind, WorkflowTriggerKind } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { vi } from 'vitest'

const generateTextMock = vi.fn()

vi.mock('ai', async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    return { ...original, generateText: (...args: unknown[]) => generateTextMock(...args) }
})

vi.mock('../../../../src/app/ai-flow-builder/ai-model-resolver', () => ({
    ModelResolutionFailure: { NO_PROVIDER: 'NO_PROVIDER', NO_TEXT_MODEL: 'NO_TEXT_MODEL' },
    aiModelResolver: () => ({
        resolveTextModel: async () => ({ model: { modelId: 'fake' }, failure: null }),
    }),
}))

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

beforeEach(() => {
    generateTextMock.mockReset()
})

function planFor({ summary, service }: { summary: string, service: string | null }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Renewal notice',
        description: 'Sends the renewal notice',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 09:00',
            service: null,
            schedule: { cronExpression: '0 9 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 09:00' },
        },
        steps: [{ id: 'deliver', kind: WorkflowStepKind.OUTPUT, summary, service, dependsOn: [] }],
    }
}

function shortlistLine({ system, line }: { system: string, line: number }): string {
    const found = system.split('\n').find((row) => row.startsWith(`${line}. `))
    expect(found).toBeDefined()
    return found ?? ''
}

describe('Workflow plan resolver with an AI provider', () => {
    it('asks the model to break the tie and binds exactly what it picked', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        generateTextMock.mockResolvedValue({ text: '1' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Send the renewal notice to the customer by email', service: 'email' }),
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(generateTextMock).toHaveBeenCalled()

        const { system } = generateTextMock.mock.calls[0][0]
        const chosenLine = shortlistLine({ system, line: 1 })
        const step = response?.json().plan.steps[0]

        expect(step.status).toBe(ToolResolutionStatus.RESOLVED)
        expect(step.confidence).toBe(ToolResolutionConfidence.MEDIUM)
        expect(chosenLine).toContain(`${step.tool.pieceDisplayName}: ${step.tool.objectDisplayName}`)
    })

    it('offers the model a shortlist, not the catalog, and never a credential', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        generateTextMock.mockResolvedValue({ text: '1' })

        await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Send the renewal notice to the customer by email', service: 'email' }),
        })

        const { system } = generateTextMock.mock.calls[0][0]
        const offered = system.split('\n').filter((row: string) => /^\d+\. /.test(row))
        expect(offered.length).toBeGreaterThan(0)
        expect(offered.length).toBeLessThanOrEqual(8)
        expect(JSON.stringify(generateTextMock.mock.calls[0][0])).not.toContain('secret_text')
    })

    it('leaves the step unresolved when the model abstains and nothing else fits', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        generateTextMock.mockResolvedValue({ text: 'none' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Score the claim with the actuarial model', service: null }),
        })

        const step = response?.json().plan.steps[0]
        expect(step.status).toBe(ToolResolutionStatus.UNRESOLVED)
        expect(step.tool).toBeNull()
    })

    it('keeps the model inside the app the plan named', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        generateTextMock.mockResolvedValue({ text: '1' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Post the renewal summary to the Slack channel', service: 'chat' }),
        })

        expect(response?.json().plan.steps[0].tool.pieceName).toBe('@activepieces/piece-slack')
        expect(shortlistLine({ system: generateTextMock.mock.calls[0][0].system, line: 1 })).toContain('Slack:')
    })

    it('spends no model call on a trigger and a step that resolve deterministically', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        const plan = planFor({ summary: 'Build the renewal summary', service: null })
        plan.steps[0].kind = WorkflowStepKind.TRANSFORM

        const response = await ctx.post('/v1/ai-flow-builder/resolve', { projectId: ctx.project.id, plan })

        expect(response?.json().plan.trigger.confidence).toBe(ToolResolutionConfidence.EXACT)
        expect(response?.json().plan.steps[0].status).toBe(ToolResolutionStatus.NO_TOOL_REQUIRED)
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('keeps a strong deterministic match when the model abstains', async () => {
        const ctx = await createTestContext(app!)
        await resolverPieces.seed({ platformId: ctx.platform.id })
        generateTextMock.mockResolvedValue({ text: 'none' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Post the renewal summary to the Slack channel', service: 'chat' }),
        })

        expect(generateTextMock).toHaveBeenCalled()
        expect(response?.json().plan.steps[0]).toMatchObject({
            status: ToolResolutionStatus.RESOLVED,
            tool: { pieceName: '@activepieces/piece-slack', objectName: 'send_channel_message' },
        })
    })
})
