import { WORKFLOW_PLAN_VERSION, WorkflowPlanStatus, WorkflowStepKind, WorkflowTriggerKind } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTextModel = vi.fn()
const generateTextMock = vi.fn()

vi.mock('../../../../src/app/ai-flow-builder/ai-model-resolver', async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    return {
        ...original,
        aiModelResolver: () => ({
            resolveTextModel: (...args: unknown[]) => resolveTextModel(...args),
        }),
    }
})

vi.mock('ai', () => ({
    generateText: (...args: unknown[]) => generateTextMock(...args),
}))

import { workflowPlannerService } from '../../../../src/app/ai-flow-builder/workflow-planner.service'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
const params = { projectId: 'project-1', platformId: 'platform-1', prompt: 'Every day at 7 AM send me the gold price change on Telegram', timezone: 'Asia/Ulaanbaatar' }

const validPlan = {
    version: WORKFLOW_PLAN_VERSION,
    name: 'Daily gold price change',
    description: 'Sends the daily change',
    trigger: {
        kind: WorkflowTriggerKind.SCHEDULE,
        summary: 'Every day at 07:00',
        service: null,
        schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 07:00' },
    },
    steps: [
        { id: 'fetch_price', kind: WorkflowStepKind.FETCH, summary: 'Fetch yesterday price', service: 'market data', dependsOn: [] },
        { id: 'compute_change', kind: WorkflowStepKind.TRANSFORM, summary: 'Compute percentage change', service: null, dependsOn: ['fetch_price'] },
        { id: 'deliver', kind: WorkflowStepKind.OUTPUT, summary: 'Send to chat', service: 'chat', dependsOn: ['compute_change'] },
    ],
}

describe('workflowPlannerService', () => {
    beforeEach(() => {
        resolveTextModel.mockReset()
        generateTextMock.mockReset()
        resolveTextModel.mockResolvedValue({ model: {}, failure: null })
    })

    it('returns a validated plan', async () => {
        generateTextMock.mockResolvedValue({ text: JSON.stringify(validPlan) })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.PLANNED)
        expect(result.plan?.steps).toHaveLength(3)
        expect(result.plan?.trigger.schedule?.cronExpression).toBe('0 7 * * *')
        expect(result.issues).toEqual([])
    })

    it('accepts a plan wrapped in a markdown fence', async () => {
        generateTextMock.mockResolvedValue({ text: '```json\n' + JSON.stringify(validPlan) + '\n```' })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.PLANNED)
    })

    it('reports UNAVAILABLE when no provider is configured', async () => {
        resolveTextModel.mockResolvedValue({ model: null, failure: 'NO_PROVIDER' })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.UNAVAILABLE)
        expect(result.plan).toBeNull()
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('distinguishes a provider with no text model', async () => {
        resolveTextModel.mockResolvedValue({ model: null, failure: 'NO_TEXT_MODEL' })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.UNAVAILABLE)
        expect(result.issues[0]).toContain('no text model')
    })

    it('rejects output that is not JSON', async () => {
        generateTextMock.mockResolvedValue({ text: 'Sure! Here is your workflow.' })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.FAILED)
        expect(result.plan).toBeNull()
    })

    it('rejects a plan that fails the schema', async () => {
        generateTextMock.mockResolvedValue({ text: JSON.stringify({ ...validPlan, steps: [] }) })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.FAILED)
        expect(result.plan).toBeNull()
        expect(result.issues.length).toBeGreaterThan(0)
    })

    it('rejects a plan that fails semantic validation', async () => {
        generateTextMock.mockResolvedValue({
            text: JSON.stringify({
                ...validPlan,
                steps: [
                    { id: 'a', kind: WorkflowStepKind.FETCH, summary: 'one', service: null, dependsOn: ['missing'] },
                ],
            }),
        })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.FAILED)
        expect(result.issues).toContain('Step "a" depends on unknown step "missing"')
    })

    it('rejects a plan whose version is not the supported one', async () => {
        generateTextMock.mockResolvedValue({ text: JSON.stringify({ ...validPlan, version: 99 }) })

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.FAILED)
    })

    it('survives the model throwing', async () => {
        generateTextMock.mockRejectedValue(new Error('provider exploded'))

        const result = await workflowPlannerService(log).plan(params)

        expect(result.status).toBe(WorkflowPlanStatus.FAILED)
        expect(result.plan).toBeNull()
    })

    it('passes the caller timezone to the model and never leaks credentials', async () => {
        generateTextMock.mockResolvedValue({ text: JSON.stringify(validPlan) })

        await workflowPlannerService(log).plan(params)

        const sent = JSON.stringify(generateTextMock.mock.calls[0][0])
        expect(sent).toContain('Asia/Ulaanbaatar')
        expect(sent).not.toContain('apiKey')
        expect(sent).not.toContain('sk-')
    })

    it('falls back to UTC when the caller timezone is nonsense', async () => {
        generateTextMock.mockResolvedValue({ text: JSON.stringify(validPlan) })

        await workflowPlannerService(log).plan({ ...params, timezone: 'Mars/Olympus' })

        expect(JSON.stringify(generateTextMock.mock.calls[0][0])).toContain('UTC')
    })
})
