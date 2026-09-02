import {
    ActivationDecision,
    ActivationHold,
    AutomationLifecycle,
    FlowActionType,
    FlowOperationType,
    FlowStatus,
    FlowVersionState,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { createMockConnection } from '../../../helpers/mocks'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const SHEETS = '@activepieces/piece-google-sheets'
const TELEGRAM = '@activepieces/piece-telegram-bot'
const DRIVE = '@activepieces/piece-google-drive'

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

async function connect({ ctx, pieceName }: { ctx: TestContext, pieceName: string }): Promise<void> {
    await db.save('app_connection', createMockConnection({ projectIds: [ctx.project.id], platformId: ctx.platform.id, pieceName, displayName: 'Account' }, ctx.user.id))
}

async function build({ ctx, steps }: { ctx: TestContext, steps: PlanStep[] }): Promise<string> {
    const response = await ctx.post('/v1/ai-flow-builder/generate', {
        projectId: ctx.project.id,
        prompt: 'publish me',
        plan: {
            version: WORKFLOW_PLAN_VERSION,
            name: 'Daily gold price change',
            description: '',
            trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 'Every day at 07:00', service: null, schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'daily' } },
            steps,
        },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json().flowId
}

async function flowOf({ ctx, flowId }: { ctx: TestContext, flowId: string }) {
    return (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
}

async function configure({ ctx, flowId, input, actionName }: { ctx: TestContext, flowId: string, input: Record<string, unknown>, actionName?: string }): Promise<void> {
    const flow = await flowOf({ ctx, flowId })
    const step = flow.version.trigger.nextAction
    const { sampleData, sampleDataInputId, ...settings } = step.settings
    const response = await ctx.post(`/v1/flows/${flowId}`, {
        type: FlowOperationType.UPDATE_ACTION,
        request: {
            type: FlowActionType.PIECE,
            name: step.name,
            displayName: step.displayName,
            valid: step.valid,
            skip: false,
            settings: { ...settings, ...(actionName === undefined ? {} : { actionName }), input: { ...step.settings.input, ...input } },
        },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
}

async function publish({ ctx, flowId, approveActivation }: { ctx: TestContext, flowId: string, approveActivation?: boolean }) {
    const response = await ctx.post('/v1/ai-flow-builder/publish', { projectId: ctx.project.id, flowId, approveActivation })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

const READ_STEP: PlanStep = { id: 'read', kind: WorkflowStepKind.FETCH, summary: 'Read the rows from the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] }
const SEND_STEP: PlanStep = { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result as a Telegram message', service: 'chat', dependsOn: [] }
const UPLOAD_STEP: PlanStep = { id: 'upload', kind: WorkflowStepKind.OUTPUT, summary: 'Upload the signed policy to Google Drive', service: 'file storage', dependsOn: [] }

async function readyReadFlow(): Promise<{ ctx: TestContext, flowId: string }> {
    const ctx = await seeded()
    await connect({ ctx, pieceName: SHEETS })
    const flowId = await build({ ctx, steps: [READ_STEP] })
    await configure({ ctx, flowId, input: { spreadsheetId: 'sheet-1' } })
    return { ctx, flowId }
}

describe('Publishing a generated flow', () => {
    describe('Lifecycle', () => {
        it('starts as a draft that is not published', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [READ_STEP] })

            const flow = await flowOf({ ctx, flowId })

            expect(flow.status).toBe(FlowStatus.DISABLED)
            expect(flow.publishedVersionId).toBeNull()
            expect(flow.version.state).toBe(FlowVersionState.DRAFT)
        })

        it('refuses to publish a flow that still needs setup', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [SEND_STEP] })

            const result = await publish({ ctx, flowId })

            expect(result.lifecycle).toBe(AutomationLifecycle.NEEDS_SETUP)
            expect(result.publishedVersionId).toBeNull()
            expect((await flowOf({ ctx, flowId })).status).toBe(FlowStatus.DISABLED)
        })

        it('will not enable a flow whose connection is missing', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [READ_STEP] })
            await configure({ ctx, flowId, input: { spreadsheetId: 'sheet-1' } })

            const result = await publish({ ctx, flowId })

            expect(result.lifecycle).toBe(AutomationLifecycle.NEEDS_SETUP)
            expect(result.validation.issues.some((issue: { rule: string }) => issue.rule === 'CONNECTION_MISSING')).toBe(true)
            expect((await flowOf({ ctx, flowId })).publishedVersionId).toBeNull()
        })

        it('publishes and activates a low risk flow', async () => {
            const { ctx, flowId } = await readyReadFlow()

            const result = await publish({ ctx, flowId })

            expect(result.lifecycle).toBe(AutomationLifecycle.ACTIVE)
            expect(result.activation.decision).toBe(ActivationDecision.AUTOMATIC)
            expect(result.publishedVersionId).not.toBeNull()
        })

        it('leaves the flow ready but paused when activation needs approval', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: DRIVE })
            const flowId = await build({ ctx, steps: [UPLOAD_STEP] })
            await configure({ ctx, flowId, actionName: 'drive_trash_file', input: { fileId: 'file-1' } })

            const result = await publish({ ctx, flowId })

            expect(result.activation.decision).toBe(ActivationDecision.NEEDS_APPROVAL)
            expect(result.activation.holds[0].hold).toBe(ActivationHold.DESTRUCTIVE_ACTION)
            expect(result.lifecycle).toBe(AutomationLifecycle.READY)
            expect(result.status).toBe(FlowStatus.DISABLED)
            expect(result.publishedVersionId).not.toBeNull()
        })

        it('activates a held flow once the person approves it', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: DRIVE })
            const flowId = await build({ ctx, steps: [UPLOAD_STEP] })
            await configure({ ctx, flowId, actionName: 'drive_trash_file', input: { fileId: 'file-1' } })

            const held = await publish({ ctx, flowId })
            const approved = await publish({ ctx, flowId, approveActivation: true })

            expect(held.lifecycle).toBe(AutomationLifecycle.READY)
            expect(approved.lifecycle).toBe(AutomationLifecycle.ACTIVE)
            expect((await flowOf({ ctx, flowId })).status).toBe(FlowStatus.ENABLED)
        })
    })

    describe('Activation policy', () => {
        it('holds a step whose action does not declare its risk', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: DRIVE })
            const flowId = await build({ ctx, steps: [UPLOAD_STEP] })
            await configure({ ctx, flowId, actionName: 'drive_export_folder_as_zip', input: { folderId: 'folder-1' } })

            const result = await publish({ ctx, flowId })

            expect(result.activation.holds[0]).toMatchObject({ hold: ActivationHold.UNDECLARED_RISK })
            expect(result.lifecycle).toBe(AutomationLifecycle.READY)
        })

        it('does not hold an ordinary write step', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM })
            const flowId = await build({ ctx, steps: [SEND_STEP] })
            await configure({ ctx, flowId, input: { chat_id: '123', message: 'hello' } })

            const result = await publish({ ctx, flowId })

            expect(result.activation.decision).toBe(ActivationDecision.AUTOMATIC)
            expect(result.lifecycle).toBe(AutomationLifecycle.ACTIVE)
        })
    })

    describe('A published generated flow is an ordinary flow', () => {
        it('locks the published version through the normal lifecycle', async () => {
            const { ctx, flowId } = await readyReadFlow()

            await publish({ ctx, flowId })
            const flow = await flowOf({ ctx, flowId })

            expect(flow.version.state).toBe(FlowVersionState.LOCKED)
            expect(flow.publishedVersionId).toBe(flow.version.id)
        })

        it('can be paused with the ordinary status operation', async () => {
            const { ctx, flowId } = await readyReadFlow()
            await publish({ ctx, flowId })

            const paused = await ctx.post(`/v1/flows/${flowId}`, { type: FlowOperationType.CHANGE_STATUS, request: { status: FlowStatus.DISABLED } })

            expect(paused?.statusCode).toBe(StatusCodes.OK)
            expect((await flowOf({ ctx, flowId })).status).toBe(FlowStatus.DISABLED)
        })

        it('keeps a normal draft version to edit after publishing', async () => {
            const { ctx, flowId } = await readyReadFlow()
            await publish({ ctx, flowId })

            const step = (await flowOf({ ctx, flowId })).version.trigger.nextAction
            const edited = await ctx.post(`/v1/flows/${flowId}`, {
                type: FlowOperationType.UPDATE_ACTION,
                request: { type: FlowActionType.PIECE, name: step.name, displayName: 'Renamed by hand', valid: step.valid, skip: false, settings: { ...step.settings, sampleData: undefined, sampleDataInputId: undefined } },
            })

            expect(edited?.statusCode).toBe(StatusCodes.OK)
            const after = await flowOf({ ctx, flowId })
            expect(after.version.state).toBe(FlowVersionState.DRAFT)
            expect(after.publishedVersionId).not.toBe(after.version.id)
        })

        it('appears in the ordinary flow list', async () => {
            const { ctx, flowId } = await readyReadFlow()
            await publish({ ctx, flowId })

            const list = await ctx.get('/v1/flows', { projectId: ctx.project.id })

            expect(list?.json().data.map((flow: { id: string }) => flow.id)).toContain(flowId)
        })

        it('shows up under the ordinary runs endpoint', async () => {
            const { ctx, flowId } = await readyReadFlow()
            await publish({ ctx, flowId })

            const runs = await ctx.get('/v1/flow-runs', { projectId: ctx.project.id, flowId })

            expect(runs?.statusCode).toBe(StatusCodes.OK)
            expect(Array.isArray(runs?.json().data)).toBe(true)
        })
    })

    it('refuses a flow in another project', async () => {
        const owner = await seeded()
        const stranger = await seeded()
        const flowId = await build({ ctx: stranger, steps: [READ_STEP] })

        const response = await owner.post('/v1/ai-flow-builder/publish', { projectId: owner.project.id, flowId })

        expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
    })
})

type PlanStep = {
    id: string
    kind: WorkflowStepKind
    summary: string
    service: string | null
    dependsOn: string[]
}
