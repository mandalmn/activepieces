import {
    BranchOperator,
    EditRejection,
    FlowActionType,
    FlowEditOperation,
    FlowEditOutcome,
    FlowStatus,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
    flowStructureUtil,
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
const GMAIL = '@activepieces/piece-gmail'
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

function edits(entries: unknown[]) {
    return { text: JSON.stringify(entries) }
}

function edit(overrides: Record<string, unknown>) {
    return {
        stepName: null,
        afterStepName: null,
        describedAction: null,
        propertyName: null,
        value: null,
        cronExpression: null,
        timezone: null,
        connectionName: null,
        condition: null,
        reason: 'because the person asked',
        ...overrides,
    }
}

const externalIds = new Map<string, string>()

async function seeded(pieces: { pieceName: string, displayName: string }[]): Promise<TestContext> {
    const ctx = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    for (const piece of pieces) {
        const connection = createMockConnection({ projectIds: [ctx.project.id], platformId: ctx.platform.id, ...piece }, ctx.user.id)
        await db.save('app_connection', connection)
        externalIds.set(piece.displayName, connection.externalId)
    }
    return ctx
}

async function goldPriceFlow({ ctx }: { ctx: TestContext }): Promise<string> {
    const response = await ctx.post('/v1/ai-flow-builder/generate', {
        projectId: ctx.project.id,
        prompt: 'gold price',
        plan: {
            version: WORKFLOW_PLAN_VERSION,
            name: 'Daily Gold Price Change',
            description: '',
            trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 'Every day at 07:00', service: null, schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'daily' } },
            steps: [
                { id: 'price', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the gold price API', service: 'web api', dependsOn: [] },
                { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result as a Telegram message', service: 'chat', dependsOn: ['price'] },
            ],
        },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json().flowId
}

async function flowOf({ ctx, flowId }: { ctx: TestContext, flowId: string }) {
    return (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
}

async function stepNames({ ctx, flowId }: { ctx: TestContext, flowId: string }): Promise<string[]> {
    const flow = await flowOf({ ctx, flowId })
    return flowStructureUtil.getAllSteps(flow.version.trigger).map((step: { name: string }) => step.name)
}

async function instruct({ ctx, flowId, instruction }: { ctx: TestContext, flowId: string, instruction: string }) {
    const response = await ctx.post('/v1/ai-flow-builder/edit', { projectId: ctx.project.id, flowId, instruction })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

describe('Conversational editing', () => {
    describe('Edit commands', () => {
        it('changes the schedule', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 8 * * *', reason: 'moved it to 8 AM' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Make it run at 8 AM instead.' })

            expect(result.outcome).toBe(FlowEditOutcome.APPLIED)
            expect((await flowOf({ ctx, flowId })).version.trigger.settings.input.cronExpression).toBe('0 8 * * *')
            expect(result.explanation).toContain('8 AM')
        })

        it('changes the schedule to weekdays only', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 7 * * 1-5', reason: 'weekdays only' })]))

            await instruct({ ctx, flowId, instruction: 'Only run Monday to Friday.' })

            expect((await flowOf({ ctx, flowId })).version.trigger.settings.input.cronExpression).toBe('0 7 * * 1-5')
        })

        it('changes the timezone as well as the time', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 9 * * *', timezone: 'Europe/London', reason: 'moved it to 9 in London' })]))

            await instruct({ ctx, flowId, instruction: 'Run at 9 London time.' })

            expect((await flowOf({ ctx, flowId })).version.trigger.settings.input).toMatchObject({ cronExpression: '0 9 * * *', timezone: 'Europe/London' })
        })

        it('adds an action', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }, { pieceName: GMAIL, displayName: 'Gmail Work' }])
            const flowId = await goldPriceFlow({ ctx })
            const before = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.ADD_ACTION, describedAction: 'Send the report by Gmail', afterStepName: before[2], reason: 'added a Gmail step' })]))

            await instruct({ ctx, flowId, instruction: 'Send it to Gmail too.' })
            const flow = await flowOf({ ctx, flowId })

            const pieces = flowStructureUtil.getAllSteps(flow.version.trigger).map((step: { settings: { pieceName?: string } }) => step.settings.pieceName)
            expect(pieces).toContain(GMAIL)
        })

        it('removes an action', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const before = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.REMOVE_ACTION, stepName: before[2], reason: 'removed Telegram' })]))

            await instruct({ ctx, flowId, instruction: 'Remove Telegram.' })

            expect(await stepNames({ ctx, flowId })).not.toContain(before[2])
        })

        it('updates the message an action sends', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.UPDATE_ACTION_INPUT, stepName: names[2], propertyName: 'message', value: 'Gold moved overnight', reason: 'reworded the message' })]))

            await instruct({ ctx, flowId, instruction: 'Change the message to say gold moved overnight.' })
            const flow = await flowOf({ ctx, flowId })

            expect(flow.version.trigger.nextAction.nextAction.settings.input.message).toBe('Gold moved overnight')
        })

        it('changes which account a step uses', async () => {
            const ctx = await seeded([
                { pieceName: GMAIL, displayName: 'Gmail Personal' },
                { pieceName: GMAIL, displayName: 'Gmail Work' },
            ])
            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'email',
                plan: {
                    version: WORKFLOW_PLAN_VERSION, name: 'Email', description: '',
                    trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 's', service: null, schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'd' } },
                    steps: [{ id: 'send', kind: WorkflowStepKind.OUTPUT, summary: 'Send the report by Gmail', service: 'email', dependsOn: [] }],
                },
            })
            const flowId = response?.json().flowId
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_CONNECTION, stepName: names[1], connectionName: 'work', reason: 'switched to the work account' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Use my work Gmail.' })
            const flow = await flowOf({ ctx, flowId })

            expect(result.outcome).toBe(FlowEditOutcome.APPLIED)
            expect(flow.version.trigger.nextAction.settings.input.auth).toBe(`{{connections['${externalIds.get('Gmail Work')}']}}`)
        })

        it('adds a condition in front of a step', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({
                operation: FlowEditOperation.ADD_CONDITION,
                stepName: names[2],
                condition: { sourceStepName: names[1], fieldPath: 'change', operator: BranchOperator.NUMBER_IS_GREATER_THAN, value: '2' },
                reason: 'only when gold moves more than 2%',
            })]))

            await instruct({ ctx, flowId, instruction: 'Only send it if gold changes more than 2%.' })
            const flow = await flowOf({ ctx, flowId })

            const router = flow.version.trigger.nextAction.nextAction
            expect(router.type).toBe(FlowActionType.ROUTER)
            expect(router.settings.branches[0].conditions[0][0]).toMatchObject({ operator: BranchOperator.NUMBER_IS_GREATER_THAN, secondValue: '2' })
            expect(router.children[0].settings.pieceName).toBe(TELEGRAM)
        })

        it('applies more than one change from one instruction', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([
                edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '30 6 * * *', reason: 'moved it earlier' }),
                edit({ operation: FlowEditOperation.UPDATE_ACTION_INPUT, stepName: names[2], propertyName: 'chat_id', value: '@gold', reason: 'set the channel' }),
            ]))

            const result = await instruct({ ctx, flowId, instruction: 'Run at 6:30 and send it to @gold.' })
            const flow = await flowOf({ ctx, flowId })

            expect(result.applied).toHaveLength(2)
            expect(flow.version.trigger.settings.input.cronExpression).toBe('30 6 * * *')
            expect(flow.version.trigger.nextAction.nextAction.settings.input.chat_id).toBe('@gold')
        })

        it('says so when the instruction is not about this automation', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([]))

            const result = await instruct({ ctx, flowId, instruction: 'What is the weather like?' })

            expect(result.outcome).toBe(FlowEditOutcome.NOT_UNDERSTOOD)
            expect(result.applied).toEqual([])
        })
    })

    describe('Multi turn editing', () => {
        it('carries the flow across turns and stacks the changes', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }, { pieceName: GMAIL, displayName: 'Gmail Work' }])
            const flowId = await goldPriceFlow({ ctx })
            const start = await stepNames({ ctx, flowId })

            generateTextMock.mockResolvedValue(edits([edit({
                operation: FlowEditOperation.ADD_CONDITION,
                stepName: start[2],
                condition: { sourceStepName: start[1], fieldPath: 'change', operator: BranchOperator.NUMBER_IS_GREATER_THAN, value: '2' },
                reason: 'only when gold moves more than 2%',
            })]))
            await instruct({ ctx, flowId, instruction: 'Only send it if price changed more than 2%.' })

            const afterCondition = await flowOf({ ctx, flowId })
            const routerName = afterCondition.version.trigger.nextAction.nextAction.name
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.ADD_ACTION, describedAction: 'Send the report by Gmail', afterStepName: routerName, reason: 'added Gmail beside Telegram' })]))
            await instruct({ ctx, flowId, instruction: 'Also send it to Gmail.' })

            const flow = await flowOf({ ctx, flowId })
            const router = flow.version.trigger.nextAction.nextAction
            const insideBranch = flowStructureUtil.getAllSteps(router.children[0]).map((step: { settings: { pieceName?: string } }) => step.settings.pieceName)
            expect(router.type).toBe(FlowActionType.ROUTER)
            expect(insideBranch).toContain(TELEGRAM)
            expect(insideBranch).toContain(GMAIL)
        })

        it('keeps a version history that can be inspected', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 8 * * *', reason: 'moved to 8' })]))
            await instruct({ ctx, flowId, instruction: 'Run at 8.' })

            const versions = await ctx.get(`/v1/flows/${flowId}/versions`, { projectId: ctx.project.id })

            expect(versions?.statusCode).toBe(StatusCodes.OK)
            expect(versions?.json().data.length).toBeGreaterThan(0)
        })

        it('republishes an already published automation after an edit', async () => {
            const ctx = await seeded([{ pieceName: '@activepieces/piece-google-sheets', displayName: 'Sheets' }])
            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'read rows',
                plan: {
                    version: WORKFLOW_PLAN_VERSION, name: 'Rows', description: '',
                    trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 's', service: null, schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'd' } },
                    steps: [{ id: 'read', kind: WorkflowStepKind.FETCH, summary: 'Read the rows from the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] }],
                },
            })
            const flowId = response?.json().flowId
            const names = await stepNames({ ctx, flowId })
            const step = (await flowOf({ ctx, flowId })).version.trigger.nextAction
            const { sampleData, sampleDataInputId, ...settings } = step.settings
            await ctx.post(`/v1/flows/${flowId}`, { type: 'UPDATE_ACTION', request: { type: FlowActionType.PIECE, name: step.name, displayName: step.displayName, valid: step.valid, skip: false, settings: { ...settings, input: { ...step.settings.input, spreadsheetId: 'sheet-1' } } } })
            await ctx.post('/v1/ai-flow-builder/publish', { projectId: ctx.project.id, flowId })

            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 8 * * *', reason: 'moved to 8' })]))
            const result = await instruct({ ctx, flowId, instruction: 'Run at 8.' })

            expect(names.length).toBeGreaterThan(1)
            expect(result.publication).not.toBeNull()
            expect((await flowOf({ ctx, flowId })).status).toBe(FlowStatus.ENABLED)
        })
    })

    describe('Safety', () => {
        it('never shows the model a credential', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([]))

            await instruct({ ctx, flowId, instruction: 'anything' })

            const sent = JSON.stringify(generateTextMock.mock.calls[0][0])
            expect(sent).not.toContain('secret_text')
            expect(sent).not.toContain('access_token')
            expect(sent).not.toContain('{{connections[')
            expect(sent).not.toContain('"auth"')
        })

        it('refuses an edit that writes a connection into a property', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.UPDATE_ACTION_INPUT, stepName: names[2], propertyName: 'chat_id', value: "{{connections['stolen']}}", reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'x' })

            expect(result.rejected[0].rejection).toBe(EditRejection.CREDENTIAL_IN_VALUE)
            expect(result.outcome).toBe(FlowEditOutcome.NOTHING_APPLIED)
        })

        it('refuses an edit that changes the connection property directly', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.UPDATE_ACTION_INPUT, stepName: names[2], propertyName: 'auth', value: 'x', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'x' })

            expect(result.rejected[0].rejection).toBe(EditRejection.PROTECTED_PROPERTY)
        })

        it('refuses an edit naming a property the action does not have', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.UPDATE_ACTION_INPUT, stepName: names[2], propertyName: 'invented', value: 'x', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'x' })

            expect(result.rejected[0].rejection).toBe(EditRejection.UNKNOWN_PROPERTY)
        })

        it('refuses an edit naming a step that is not in the flow', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.REMOVE_ACTION, stepName: 'step_99', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'x' })

            expect(result.rejected[0].rejection).toBe(EditRejection.UNKNOWN_STEP)
        })

        it('refuses to remove the last remaining step', async () => {
            const ctx = await seeded([{ pieceName: GMAIL, displayName: 'Gmail Work' }])
            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'email',
                plan: {
                    version: WORKFLOW_PLAN_VERSION, name: 'Email', description: '',
                    trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 's', service: null, schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'd' } },
                    steps: [{ id: 'send', kind: WorkflowStepKind.OUTPUT, summary: 'Send the report by Gmail', service: 'email', dependsOn: [] }],
                },
            })
            const flowId = response?.json().flowId
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.REMOVE_ACTION, stepName: names[1], reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Remove everything.' })

            expect(result.rejected[0].rejection).toBe(EditRejection.WOULD_EMPTY_THE_FLOW)
        })

        it('refuses a nonsense schedule', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: 'whenever', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Run whenever.' })

            expect(result.rejected[0].rejection).toBe(EditRejection.INVALID_SCHEDULE)
        })

        it('refuses an account name that matches nothing', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            const names = await stepNames({ ctx, flowId })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_CONNECTION, stepName: names[2], connectionName: 'nonexistent', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Use my other account.' })

            expect(result.rejected[0].rejection).toBe(EditRejection.NO_SUCH_CONNECTION)
        })
    })

    describe('Every edit is validated', () => {
        it('returns a validation report on every turn', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.CHANGE_SCHEDULE, cronExpression: '0 8 * * *', reason: 'moved to 8' })]))

            const result = await instruct({ ctx, flowId, instruction: 'Run at 8.' })

            expect(result.validation.readiness).toBeDefined()
            expect(Array.isArray(result.validation.issues)).toBe(true)
            expect(result.validation.steps.length).toBeGreaterThan(0)
        })

        it('validates even when nothing was applied', async () => {
            const ctx = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx })
            generateTextMock.mockResolvedValue(edits([edit({ operation: FlowEditOperation.REMOVE_ACTION, stepName: 'step_99', reason: 'nope' })]))

            const result = await instruct({ ctx, flowId, instruction: 'x' })

            expect(result.validation.steps.length).toBeGreaterThan(0)
        })

        it('refuses a flow in another project', async () => {
            const owner = await seeded([])
            const stranger = await seeded([{ pieceName: TELEGRAM, displayName: 'Telegram Personal' }])
            const flowId = await goldPriceFlow({ ctx: stranger })

            const response = await owner.post('/v1/ai-flow-builder/edit', { projectId: owner.project.id, flowId, instruction: 'Run at 8.' })

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })
})
