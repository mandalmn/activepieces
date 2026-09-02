import {
    FlowActionType,
    FlowOperationType,
    FlowReadiness,
    FlowValidationRule,
    FlowValidationSeverity,
    StepTestability,
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

async function seeded(): Promise<TestContext> {
    const ctx = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    return ctx
}

async function connect({ ctx, pieceName, displayName }: { ctx: TestContext, pieceName: string, displayName: string }): Promise<void> {
    await db.save('app_connection', createMockConnection({ projectIds: [ctx.project.id], platformId: ctx.platform.id, pieceName, displayName }, ctx.user.id))
}

function planWith({ steps }: { steps: PlanStep[] }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Validated plan',
        description: '',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 07:00',
            service: null,
            schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 07:00' },
        },
        steps,
    }
}

async function build({ ctx, steps }: { ctx: TestContext, steps: PlanStep[] }): Promise<string> {
    const generated = await ctx.post('/v1/ai-flow-builder/generate', { projectId: ctx.project.id, prompt: 'validate me', plan: planWith({ steps }) })
    expect(generated?.statusCode).toBe(StatusCodes.OK)
    return generated?.json().flowId
}

async function validate({ ctx, flowId }: { ctx: TestContext, flowId: string }) {
    const response = await ctx.post('/v1/ai-flow-builder/validate', { projectId: ctx.project.id, flowId })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

function rulesOf(report: { issues: { rule: string }[] }): string[] {
    return report.issues.map((issue) => issue.rule)
}

async function fillStep({ ctx, flowId, stepName, input }: { ctx: TestContext, flowId: string, stepName: string, input: Record<string, unknown> }): Promise<void> {
    const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
    const step = [flow.version.trigger, flow.version.trigger.nextAction, flow.version.trigger.nextAction?.nextAction]
        .filter(Boolean)
        .find((candidate: { name: string }) => candidate.name === stepName)
    expect(step).toBeDefined()

    const { sampleData, sampleDataInputId, ...settings } = step.settings
    const response = await ctx.post(`/v1/flows/${flowId}`, {
        type: FlowOperationType.UPDATE_ACTION,
        request: {
            type: FlowActionType.PIECE,
            name: step.name,
            displayName: step.displayName,
            valid: step.valid,
            skip: step.skip ?? false,
            settings: { ...settings, input: { ...step.settings.input, ...input } },
        },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
}

const TELEGRAM_STEP: PlanStep = { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result as a Telegram message', service: 'chat', dependsOn: [] }
const SHEETS_READ_STEP: PlanStep = { id: 'read', kind: WorkflowStepKind.FETCH, summary: 'Read the rows from the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] }

describe('Generated flow validation', () => {
    describe('An invalid generated flow', () => {
        it('reports every unfilled required property by name', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })

            const report = await validate({ ctx, flowId: await build({ ctx, steps: [TELEGRAM_STEP] }) })

            const missing = report.issues.filter((issue: { rule: string }) => issue.rule === FlowValidationRule.REQUIRED_PROPERTY_MISSING)
            expect(missing.map((issue: { propertyName: string }) => issue.propertyName)).toContain('chat_id')
            expect(missing.every((issue: { severity: string }) => issue.severity === FlowValidationSeverity.ERROR)).toBe(true)
        })

        it('reports a missing connection separately from a missing field', async () => {
            const ctx = await seeded()

            const report = await validate({ ctx, flowId: await build({ ctx, steps: [TELEGRAM_STEP] }) })

            expect(rulesOf(report)).toContain(FlowValidationRule.CONNECTION_MISSING)
            const connectionIssue = report.issues.find((issue: { rule: string }) => issue.rule === FlowValidationRule.CONNECTION_MISSING)
            expect(connectionIssue.propertyName).toBe('auth')
        })

        it('says the flow is not publishable and needs repair', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })

            const report = await validate({ ctx, flowId: await build({ ctx, steps: [TELEGRAM_STEP] }) })

            expect(report.publishable).toBe(false)
            expect(report.readiness).toBe(FlowReadiness.NEEDS_REPAIR)
        })

        it('says a connection is the only thing missing when that is true', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [SHEETS_READ_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { spreadsheetId: 'sheet-1' } })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).toEqual([FlowValidationRule.CONNECTION_MISSING])
            expect(report.readiness).toBe(FlowReadiness.MISSING_CONNECTION)
        })

        it('reports a flow that has a trigger but nothing to run', async () => {
            const ctx = await seeded()
            const flowId = await build({ ctx, steps: [{ id: 'nothing', kind: WorkflowStepKind.TRANSFORM, summary: 'Reshape the data', service: null, dependsOn: [] }] })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).toContain(FlowValidationRule.EMPTY_FLOW)
        })

        it('reports an expression that points at a step which does not exist', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { chat_id: "{{step_9['output'].id}}" } })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).toContain(FlowValidationRule.UNKNOWN_STEP_REFERENCE)
        })

        it('reports an expression that points at a step which runs later', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
            const flowId = await build({
                ctx,
                steps: [
                    { id: 'first', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the pricing API', service: 'web api', dependsOn: [] },
                    { ...TELEGRAM_STEP, dependsOn: ['first'] },
                ],
            })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            const laterName = flow.version.trigger.nextAction.nextAction.name
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { url: `{{${laterName}['output'].id}}` } })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).toContain(FlowValidationRule.FORWARD_STEP_REFERENCE)
        })

        it('reports a malformed expression', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { chat_id: "{{step_1['output'}}" } })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).toContain(FlowValidationRule.MALFORMED_EXPRESSION)
        })
    })

    describe('A valid generated flow', () => {
        it('is ready and publishable once every requirement is met', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: SHEETS, displayName: 'Sheets Work' })
            const flowId = await build({ ctx, steps: [SHEETS_READ_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { spreadsheetId: 'sheet-1' } })

            const report = await validate({ ctx, flowId })

            expect(report.issues).toEqual([])
            expect(report.readiness).toBe(FlowReadiness.READY)
            expect(report.publishable).toBe(true)
            expect(report.steps.every((step: { valid: boolean }) => step.valid)).toBe(true)
        })

        it('accepts a well formed reference to an earlier step', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
            const flowId = await build({
                ctx,
                steps: [
                    { id: 'first', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the pricing API', service: 'web api', dependsOn: [] },
                    { ...TELEGRAM_STEP, dependsOn: ['first'] },
                ],
            })

            const report = await validate({ ctx, flowId })

            expect(rulesOf(report)).not.toContain(FlowValidationRule.UNKNOWN_STEP_REFERENCE)
            expect(rulesOf(report)).not.toContain(FlowValidationRule.FORWARD_STEP_REFERENCE)
            expect(rulesOf(report)).not.toContain(FlowValidationRule.MALFORMED_EXPRESSION)
        })
    })

    describe('Testability', () => {
        it('never offers to auto test a step that writes to an external service', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
            const flowId = await build({ ctx, steps: [TELEGRAM_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { chat_id: '123', message: 'hello' } })

            const report = await validate({ ctx, flowId })

            const telegram = report.steps.find((step: { pieceName: string }) => step.pieceName === TELEGRAM)
            expect(telegram.valid).toBe(true)
            expect(telegram.testability).toBe(StepTestability.UNSAFE_TO_AUTO_TEST)
        })

        it('offers to test a read only step once it is configured', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: SHEETS, displayName: 'Sheets Work' })
            const flowId = await build({ ctx, steps: [SHEETS_READ_STEP] })
            const flow = (await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id }))?.json()
            await fillStep({ ctx, flowId, stepName: flow.version.trigger.nextAction.name, input: { spreadsheetId: 'sheet-1' } })

            const report = await validate({ ctx, flowId })

            expect(report.steps.find((step: { pieceName: string }) => step.pieceName === SHEETS).testability).toBe(StepTestability.TESTABLE)
        })

        it('will not test a read only step that is still missing configuration', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: SHEETS, displayName: 'Sheets Work' })

            const report = await validate({ ctx, flowId: await build({ ctx, steps: [SHEETS_READ_STEP] }) })

            expect(report.steps.find((step: { pieceName: string }) => step.pieceName === SHEETS).testability).toBe(StepTestability.NOT_CONFIGURED)
        })

        it('never treats the trigger as an auto testable step', async () => {
            const ctx = await seeded()

            const report = await validate({ ctx, flowId: await build({ ctx, steps: [TELEGRAM_STEP] }) })

            expect(report.steps[0]).toMatchObject({ isTrigger: true, testability: StepTestability.NOT_APPLICABLE })
        })

        it('leaves an unconfigured HTTP step out of the testable set', async () => {
            const ctx = await seeded()

            const report = await validate({
                ctx,
                flowId: await build({ ctx, steps: [{ id: 'call', kind: WorkflowStepKind.FETCH, summary: 'Send an HTTP request to the pricing API', service: 'web api', dependsOn: [] }] }),
            })

            expect(report.steps.find((step: { pieceName: string }) => step.pieceName === HTTP).testability).toBe(StepTestability.NOT_CONFIGURED)
        })
    })

    it('refuses a flow in another project', async () => {
        const owner = await seeded()
        const stranger = await seeded()
        const flowId = await build({ ctx: stranger, steps: [TELEGRAM_STEP] })

        const response = await owner.post('/v1/ai-flow-builder/validate', { projectId: owner.project.id, flowId })

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
