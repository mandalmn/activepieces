import {
    FlowActionType,
    FlowOperationType,
    FlowReadiness,
    FlowValidationRule,
    MAX_REPAIR_ATTEMPTS,
    PatchRejection,
    RepairOperation,
    RepairOutcome,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
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
    aiModelResolver: () => ({ resolveTextModel: async () => ({ model: { modelId: 'fake' }, failure: null }) }),
}))

import { db } from '../../../helpers/db'
import { createMockConnection } from '../../../helpers/mocks'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const TELEGRAM = '@activepieces/piece-telegram-bot'
const SHEETS = '@activepieces/piece-google-sheets'
const HTTP = '@activepieces/piece-http'

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

function patches(entries: unknown[]) {
    return { text: JSON.stringify(entries) }
}

async function seeded(): Promise<TestContext> {
    const ctx = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    return ctx
}

async function connect({ ctx, pieceName }: { ctx: TestContext, pieceName: string }): Promise<void> {
    await db.save('app_connection', createMockConnection({ projectIds: [ctx.project.id], platformId: ctx.platform.id, pieceName, displayName: 'Account' }, ctx.user.id))
}

function planOf({ steps }: { steps: PlanStep[] }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Repairable plan',
        description: '',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 07:00',
            service: null,
            schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'daily' },
        },
        steps,
    }
}

async function build({ ctx, steps }: { ctx: TestContext, steps: PlanStep[] }): Promise<string> {
    const response = await ctx.post('/v1/ai-flow-builder/generate', { projectId: ctx.project.id, prompt: 'build it', plan: planOf({ steps }) })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json().flowId
}

async function flowOf({ ctx, flowId }: { ctx: TestContext, flowId: string }) {
    return (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
}

async function setInput({ ctx, flowId, stepName, input }: { ctx: TestContext, flowId: string, stepName: string, input: Record<string, unknown> }): Promise<void> {
    const flow = await flowOf({ ctx, flowId })
    const chain = [flow.version.trigger, flow.version.trigger.nextAction, flow.version.trigger.nextAction?.nextAction].filter(Boolean)
    const step = chain.find((candidate: { name: string }) => candidate.name === stepName)
    const { sampleData, sampleDataInputId, ...settings } = step.settings
    const response = await ctx.post(`/v1/flows/${flowId}`, {
        type: FlowOperationType.UPDATE_ACTION,
        request: { type: FlowActionType.PIECE, name: step.name, displayName: step.displayName, valid: step.valid, skip: false, settings: { ...settings, input: { ...step.settings.input, ...input } } },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
}

async function repair({ ctx, flowId, prompt = 'send it' }: { ctx: TestContext, flowId: string, prompt?: string }) {
    const response = await ctx.post('/v1/ai-flow-builder/repair', { projectId: ctx.project.id, flowId, prompt, plan: null })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

const TELEGRAM_STEP: PlanStep = { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result as a Telegram message', service: 'chat', dependsOn: [] }
const SHEETS_STEP: PlanStep = { id: 'read', kind: WorkflowStepKind.FETCH, summary: 'Read the rows from the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] }

describe('AI auto repair', () => {
    describe('Repair scenarios', () => {
        it('fills a missing required parameter', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'chat_id', value: '@mandal_alerts', actionName: null, reason: 'the request names the channel' },
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'message', value: 'Daily update', actionName: null, reason: 'a message body is required' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.outcome).toBe(RepairOutcome.REPAIRED)
            expect(result.validation.readiness).toBe(FlowReadiness.READY)
            expect((await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.input.chat_id).toBe('@mandal_alerts')
        })

        it('moves a value written under a property that does not exist', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            await setInput({ ctx, flowId, stepName, input: { text: 'hello there', chat_id: '123' } })
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.CLEAR_PROPERTY, stepName, propertyName: 'text', value: null, actionName: null, reason: 'text is not a property of this action' },
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'message', value: 'hello there', actionName: null, reason: 'the body belongs under message' },
            ]))

            const result = await repair({ ctx, flowId })

            const input = (await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.input
            expect(input.message).toBe('hello there')
            expect(input.text).toBeUndefined()
            expect(result.outcome).toBe(RepairOutcome.REPAIRED)
        })

        it('rewrites an expression that points at a step which does not exist', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({
                ctx,
                steps: [
                    { id: 'fetch', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the pricing API', service: 'web api', dependsOn: [] },
                    { ...TELEGRAM_STEP, dependsOn: ['fetch'] },
                ],
            })
            const flow = await flowOf({ ctx, flowId })
            const first = flow.version.trigger.nextAction.name
            const second = flow.version.trigger.nextAction.nextAction.name
            await setInput({ ctx, flowId, stepName: second, input: { chat_id: '123', message: "{{gold_price['output'].change}}" } })
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName: second, propertyName: 'message', value: `{{${first}['output'].change}}`, actionName: null, reason: 'the earlier step is named differently' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.validation.issues.map((issue: { rule: string }) => issue.rule)).not.toContain(FlowValidationRule.UNKNOWN_STEP_REFERENCE)
            expect(result.outcome).toBe(RepairOutcome.IMPROVED)
        })

        it('fixes a malformed expression', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            await setInput({ ctx, flowId, stepName, input: { chat_id: "{{trigger['output'}}", message: 'hi' } })
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'chat_id', value: "{{trigger['output'].chatId}}", actionName: null, reason: 'the bracket was not closed' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.validation.issues.map((issue: { rule: string }) => issue.rule)).not.toContain(FlowValidationRule.MALFORMED_EXPRESSION)
            expect(result.attempts[0].applied).toHaveLength(1)
        })

        it('switches to a different action on the same app when the evidence is clear', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: SHEETS })
            const flowId = await build({
                ctx,
                steps: [{ id: 'rows', kind: WorkflowStepKind.OUTPUT, summary: 'Add the row to the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] }],
            })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            await setInput({ ctx, flowId, stepName, input: { spreadsheetId: 'sheet-1' } })
            const before = (await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.actionName
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.REPLACE_ACTION, stepName, propertyName: null, value: null, actionName: 'sheets_find_rows', reason: 'the person asked to read rows, not add one' },
            ]))

            const result = await repair({ ctx, flowId, prompt: 'read the policy rows from the sheet every morning' })
            const after = (await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.actionName

            expect(before).toBe('insert_row')
            expect(after).toBe('sheets_find_rows')
            expect(result.outcome).toBe(RepairOutcome.REPAIRED)
        })
    })

    describe('Safety', () => {
        it('never lets the model see a credential or a connection', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            generateTextMock.mockResolvedValue(patches([]))

            await repair({ ctx, flowId })

            const sent = JSON.stringify(generateTextMock.mock.calls[0][0])
            expect(sent).not.toContain('secret_text')
            expect(sent).not.toContain('access_token')
            expect(sent).not.toContain('{{connections[')
            expect(sent).not.toContain('"auth"')
        })

        it('throws away a patch that tries to write a connection into a property', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'chat_id', value: "{{connections['stolen']}}", actionName: null, reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0].rejected[0].rejection).toBe(PatchRejection.CREDENTIAL_IN_VALUE)
            expect(result.attempts[0].applied).toHaveLength(0)
        })

        it('throws away a patch that tries to change the connection itself', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'auth', value: 'anything', actionName: null, reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0].rejected[0].rejection).toBe(PatchRejection.PROTECTED_PROPERTY)
        })

        it('throws away a patch naming a property the action does not declare', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'invented_field', value: 'x', actionName: null, reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0].rejected[0].rejection).toBe(PatchRejection.UNKNOWN_PROPERTY)
        })

        it('throws away a patch naming a step that is not in the flow', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName: 'step_99', propertyName: 'chat_id', value: 'x', actionName: null, reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0].rejected[0].rejection).toBe(PatchRejection.UNKNOWN_STEP)
        })

        it('will not switch to an action on a different app', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.REPLACE_ACTION, stepName, propertyName: null, value: null, actionName: 'insert_row', reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0].rejected[0].rejection).toBe(PatchRejection.UNKNOWN_ACTION)
            expect((await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.pieceName).toBe(TELEGRAM)
        })
    })

    describe('Bounds and honesty', () => {
        it('never attempts more than the allowed number of repairs', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'chat_id', value: '', actionName: null, reason: 'unhelpful' },
            ]))

            const callsBeforeRepair = generateTextMock.mock.calls.length
            const result = await repair({ ctx, flowId })

            expect(result.attempts).toHaveLength(MAX_REPAIR_ATTEMPTS)
            expect(generateTextMock.mock.calls.length - callsBeforeRepair).toBe(MAX_REPAIR_ATTEMPTS)
            expect(result.attempts.every((attempt: { revertedForRegression: boolean }) => attempt.revertedForRegression)).toBe(true)
        })

        it('reverts a repair that leaves the flow no better than before', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            await setInput({ ctx, flowId, stepName, input: { chat_id: '123', message: 'good' } })
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.CLEAR_PROPERTY, stepName, propertyName: 'message', value: null, actionName: null, reason: 'unhelpful' },
            ]))

            await repair({ ctx, flowId })

            expect((await flowOf({ ctx, flowId })).version.trigger.nextAction.settings.input.message).toBe('good')
        })

        it('does not try to repair a missing connection and says so', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [SHEETS_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            await setInput({ ctx, flowId, stepName, input: { spreadsheetId: 'sheet-1' } })

            const result = await repair({ ctx, flowId })

            expect(result.unrepairableRules).toContain(FlowValidationRule.CONNECTION_MISSING)
            expect(generateTextMock).not.toHaveBeenCalled()
            expect(result.attempts).toEqual([])
        })

        it('keeps a history of what it tried', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const stepName = (await flowOf({ ctx, flowId })).version.trigger.nextAction.name
            generateTextMock.mockResolvedValue(patches([
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'chat_id', value: '123', actionName: null, reason: 'the chat is named in the request' },
                { operation: RepairOperation.SET_PROPERTY, stepName, propertyName: 'invented', value: 'x', actionName: null, reason: 'nope' },
            ]))

            const result = await repair({ ctx, flowId })

            expect(result.attempts[0]).toMatchObject({ attempt: 1, errorsBefore: 2, errorsAfter: 1, revertedForRegression: false })
            expect(result.attempts[0].applied[0].reason).toBe('the chat is named in the request')
            expect(result.attempts[0].rejected).toHaveLength(1)
        })

        it('reports that it could not help rather than looping', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            generateTextMock.mockResolvedValue(patches([]))

            const result = await repair({ ctx, flowId })

            expect(result.outcome).toBe(RepairOutcome.NOT_ATTEMPTED)
            expect(result.validation.readiness).toBe(FlowReadiness.NEEDS_REPAIR)
        })

        it('adds no steps to the flow no matter what the model returns', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const before = await flowOf({ ctx, flowId })
            generateTextMock.mockResolvedValue({ text: JSON.stringify([{ operation: 'ADD_ACTION', stepName: 'step_1', propertyName: null, value: null, actionName: 'send_text_message', reason: 'nope' }]) })

            await repair({ ctx, flowId })
            const after = await flowOf({ ctx, flowId })

            expect(after.version.trigger.nextAction.nextAction).toBeUndefined()
            expect(after.version.trigger.nextAction.settings.pieceName).toBe(before.version.trigger.nextAction.settings.pieceName)
        })

        it('survives the model returning something that is not JSON', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: HTTP })
            const flowId = await build({ ctx, steps: [{ id: 'call', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the pricing API', service: 'web api', dependsOn: [] }] })
            generateTextMock.mockResolvedValue({ text: 'Sure! Here is what I would change.' })

            const result = await repair({ ctx, flowId })

            expect(result.outcome).toBe(RepairOutcome.NOT_ATTEMPTED)
        })

        it('refuses a flow in another project', async () => {
            const owner = await seeded()
            const stranger = await seeded()
            const flowId = await build({ ctx: stranger, steps: [TELEGRAM_STEP] })

            const response = await owner.post('/v1/ai-flow-builder/repair', { projectId: owner.project.id, flowId, prompt: 'x', plan: null })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })
})

type PlanStep = {
    id: string
    kind: WorkflowStepKind
    summary: string
    service: string | null
    dependsOn: string[]
}
