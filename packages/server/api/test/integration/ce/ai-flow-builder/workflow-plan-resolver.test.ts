import {
    ConnectionBindingStatus,
    ResolvedToolKind,
    ResolveWorkflowPlanStatus,
    ToolResolutionConfidence,
    ToolResolutionStatus,
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
    await db.save('app_connection', createMockConnection({
        projectIds: [ctx.project.id],
        platformId: ctx.platform.id,
        pieceName,
    }, ctx.user.id))
}

function scheduleTrigger() {
    return {
        kind: WorkflowTriggerKind.SCHEDULE,
        summary: 'Every day at 07:00',
        service: null,
        schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 07:00' },
    }
}

function planWith({ steps, trigger = scheduleTrigger() }: { steps: unknown[], trigger?: unknown }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Test plan',
        description: 'A plan under resolution',
        trigger,
        steps,
    }
}

function outputStep({ summary, service, id = 'deliver' }: { summary: string, service: string | null, id?: string }) {
    return { id, kind: WorkflowStepKind.OUTPUT, summary, service, dependsOn: [] }
}

async function resolve({ ctx, plan }: { ctx: TestContext, plan: unknown }) {
    const response = await ctx.post('/v1/ai-flow-builder/resolve', { projectId: ctx.project.id, plan })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json()
}

async function resolveOneStep({ summary, service, connectedPiece }: { summary: string, service: string | null, connectedPiece?: string }) {
    const ctx = await seeded()
    if (connectedPiece !== undefined) {
        await connect({ ctx, pieceName: connectedPiece })
    }
    const body = await resolve({ ctx, plan: planWith({ steps: [outputStep({ summary, service })] }) })
    return body.plan.steps[0]
}

describe('Workflow plan resolver', () => {
    describe('Triggers', () => {
        it('binds a scheduled trigger to the schedule piece without guessing', async () => {
            const ctx = await seeded()

            const body = await resolve({ ctx, plan: planWith({ steps: [outputStep({ summary: 'Send a Slack message', service: 'chat' })] }) })

            expect(body.status).toBe(ResolveWorkflowPlanStatus.RESOLVED)
            expect(body.plan.trigger).toMatchObject({
                status: ToolResolutionStatus.RESOLVED,
                confidence: ToolResolutionConfidence.EXACT,
                tool: {
                    kind: ResolvedToolKind.TRIGGER,
                    pieceName: '@activepieces/piece-schedule',
                    objectName: 'cron_expression',
                    requiresConnection: false,
                },
            })
            expect(body.plan.trigger.schedule).toMatchObject({ cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar' })
        })

        it('binds a manual trigger to the manual trigger piece', async () => {
            const ctx = await seeded()
            const trigger = { kind: WorkflowTriggerKind.MANUAL, summary: 'Started by hand', service: null, schedule: null }

            const body = await resolve({ ctx, plan: planWith({ trigger, steps: [outputStep({ summary: 'Send a Slack message', service: 'chat' })] }) })

            expect(body.plan.trigger.tool).toMatchObject({
                pieceName: '@activepieces/piece-manual-trigger',
                objectName: 'manual_trigger',
            })
            expect(body.plan.trigger.confidence).toBe(ToolResolutionConfidence.EXACT)
        })

        it('matches a named app event to that app own trigger', async () => {
            const ctx = await seeded()
            const trigger = { kind: WorkflowTriggerKind.EVENT, summary: 'When a new row is added to the Google Sheets spreadsheet', service: 'spreadsheet', schedule: null }

            const body = await resolve({ ctx, plan: planWith({ trigger, steps: [outputStep({ summary: 'Send a Slack message', service: 'chat' })] }) })

            expect(body.plan.trigger.status).toBe(ToolResolutionStatus.RESOLVED)
            expect(body.plan.trigger.tool).toMatchObject({
                kind: ResolvedToolKind.TRIGGER,
                pieceName: '@activepieces/piece-google-sheets',
                objectName: 'new_row_added',
            })
        })

        it('falls back to a webhook when no app trigger matches the event', async () => {
            const ctx = await seeded()
            const trigger = { kind: WorkflowTriggerKind.EVENT, summary: 'When the mainframe posts a settlement batch', service: 'mainframe', schedule: null }

            const body = await resolve({ ctx, plan: planWith({ trigger, steps: [outputStep({ summary: 'Send a Slack message', service: 'chat' })] }) })

            expect(body.plan.trigger.status).toBe(ToolResolutionStatus.FALLBACK)
            expect(body.plan.trigger.tool).toMatchObject({
                pieceName: '@activepieces/piece-webhook',
                objectName: 'catch_webhook',
            })
        })
    })

    describe('Named apps', () => {
        it.each([
            ['Send the alert as a Telegram message', 'chat', '@activepieces/piece-telegram-bot', 'send_text_message'],
            ['Post the summary to the Slack channel', 'chat', '@activepieces/piece-slack', 'send_channel_message'],
            ['Send the summary to the Microsoft Teams channel', 'chat', '@activepieces/piece-microsoft-teams', 'microsoft_teams_send_channel_message'],
            ['Send the report by Gmail', 'email', '@activepieces/piece-gmail', 'send_email'],
            ['Send the report with Microsoft Outlook', 'email', '@activepieces/piece-microsoft-outlook', 'send-email'],
            ['Add the row to the Google Sheets spreadsheet', 'spreadsheet', '@activepieces/piece-google-sheets', 'insert_row'],
            ['Add the row to the Microsoft Excel workbook', 'spreadsheet', '@activepieces/piece-microsoft-excel-365', 'append_row'],
            ['Upload the file to Google Drive', 'file storage', '@activepieces/piece-google-drive', 'drive_upload_file'],
            ['Upload the file to Microsoft OneDrive', 'file storage', '@activepieces/piece-microsoft-onedrive', 'upload_onedrive_file'],
        ])('resolves "%s" to the named app', async (summary, service, pieceName, objectName) => {
            const step = await resolveOneStep({ summary, service })

            expect(step.status).toBe(ToolResolutionStatus.RESOLVED)
            expect(step.tool).toMatchObject({ kind: ResolvedToolKind.ACTION, pieceName, objectName })
        })

        it('never substitutes a generic HTTP request for a named app', async () => {
            const step = await resolveOneStep({ summary: 'Post the summary to the Slack channel', service: 'chat' })

            expect(step.tool.pieceName).not.toBe('@activepieces/piece-http')
        })
    })

    describe('Connections steer an unnamed app', () => {
        it('sends email through Outlook when only Outlook is connected', async () => {
            const step = await resolveOneStep({ summary: 'Send the report to the team by email', service: 'email', connectedPiece: '@activepieces/piece-microsoft-outlook' })

            expect(step.tool).toMatchObject({
                pieceName: '@activepieces/piece-microsoft-outlook',
                objectName: 'send-email',
                connection: { status: ConnectionBindingStatus.BOUND },
            })
        })

        it('sends email through Gmail when only Gmail is connected', async () => {
            const step = await resolveOneStep({ summary: 'Send the report to the team by email', service: 'email', connectedPiece: '@activepieces/piece-gmail' })

            expect(step.tool).toMatchObject({
                pieceName: '@activepieces/piece-gmail',
                objectName: 'send_email',
                connection: { status: ConnectionBindingStatus.BOUND },
            })
        })

        it('still names the app the plan asked for even when a rival is connected', async () => {
            const step = await resolveOneStep({ summary: 'Send the report with Microsoft Outlook', service: 'email', connectedPiece: '@activepieces/piece-gmail' })

            expect(step.tool).toMatchObject({
                pieceName: '@activepieces/piece-microsoft-outlook',
                connection: { status: ConnectionBindingStatus.MISSING },
            })
        })
    })

    describe('HTTP', () => {
        it('resolves an explicit HTTP request to the HTTP piece as a real match', async () => {
            const step = await resolveOneStep({ summary: 'Send an HTTP request to the partner pricing API', service: 'web api' })

            expect(step.status).toBe(ToolResolutionStatus.RESOLVED)
            expect(step.tool).toMatchObject({
                pieceName: '@activepieces/piece-http',
                objectName: 'send_request',
                requiresConnection: false,
            })
        })

        it('falls back to HTTP when no native piece covers the service', async () => {
            const step = await resolveOneStep({ summary: 'Push the policy record into the in house underwriting mainframe', service: 'mainframe' })

            expect(step.status).toBe(ToolResolutionStatus.FALLBACK)
            expect(step.tool).toMatchObject({ pieceName: '@activepieces/piece-http', objectName: 'send_request' })
            expect(step.confidence).toBe(ToolResolutionConfidence.LOW)
        })
    })

    describe('Honest abstention', () => {
        it('needs no tool for a transform that only reshapes data the flow holds', async () => {
            const ctx = await seeded()
            const step = { id: 'compose', kind: WorkflowStepKind.TRANSFORM, summary: 'Format the policy list as a table', service: null, dependsOn: [] }

            const body = await resolve({ ctx, plan: planWith({ steps: [step] }) })

            expect(body.plan.steps[0]).toMatchObject({
                status: ToolResolutionStatus.NO_TOOL_REQUIRED,
                confidence: ToolResolutionConfidence.EXACT,
                tool: null,
            })
            expect(body.status).toBe(ResolveWorkflowPlanStatus.RESOLVED)
        })

        it('needs no tool for a condition that branches on data the flow holds', async () => {
            const ctx = await seeded()
            const step = { id: 'check', kind: WorkflowStepKind.CONDITION, summary: 'Only continue when the policy expires this week', service: null, dependsOn: [] }

            const body = await resolve({ ctx, plan: planWith({ steps: [step] }) })

            expect(body.plan.steps[0].status).toBe(ToolResolutionStatus.NO_TOOL_REQUIRED)
            expect(body.status).toBe(ResolveWorkflowPlanStatus.RESOLVED)
        })

        it('reports a transform against an unknown service as unresolved rather than guessing', async () => {
            const ctx = await seeded()
            const step = { id: 'enrich', kind: WorkflowStepKind.TRANSFORM, summary: 'Score the claim with the actuarial mainframe model', service: 'mainframe', dependsOn: [] }

            const body = await resolve({ ctx, plan: planWith({ steps: [step] }) })

            expect(body.plan.steps[0]).toMatchObject({ status: ToolResolutionStatus.UNRESOLVED, tool: null })
            expect(body.plan.steps[0].reason).toEqual(expect.any(String))
            expect(body.plan.unresolvedStepIds).toEqual(['enrich'])
            expect(body.status).toBe(ResolveWorkflowPlanStatus.PARTIAL)
        })
    })

    describe('Plan shape', () => {
        it('keeps the plan structure, ids and dependencies intact', async () => {
            const ctx = await seeded()
            const steps = [
                { id: 'fetch_rows', kind: WorkflowStepKind.FETCH, summary: 'Read the policy rows from the Google Sheets spreadsheet', service: 'spreadsheet', dependsOn: [] },
                { id: 'compose', kind: WorkflowStepKind.TRANSFORM, summary: 'Build the renewal summary', service: null, dependsOn: ['fetch_rows'] },
                { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the summary to the Microsoft Teams channel', service: 'chat', dependsOn: ['compose'] },
            ]

            const body = await resolve({ ctx, plan: planWith({ steps }) })

            expect(body.plan.steps.map((step: { id: string }) => step.id)).toEqual(['fetch_rows', 'compose', 'notify'])
            expect(body.plan.steps[2].dependsOn).toEqual(['compose'])
            expect(body.plan.steps[0].tool.pieceName).toBe('@activepieces/piece-google-sheets')
            expect(body.plan.steps[1].tool).toBeNull()
            expect(body.plan.steps[2].tool.pieceName).toBe('@activepieces/piece-microsoft-teams')
        })

        it('reports the piece version and required inputs the next stage must fill', async () => {
            const step = await resolveOneStep({ summary: 'Post the summary to the Slack channel', service: 'chat' })

            expect(step.tool.pieceVersion).toBe('1.0.0')
            expect(step.tool.requiredProperties).toEqual(['channel', 'text'])
            expect(step.tool.requiresConnection).toBe(true)
        })

        it('keeps the exactly named app ahead of its vendor siblings', async () => {
            const step = await resolveOneStep({ summary: 'Send the renewal notice with Microsoft Outlook', service: 'email' })

            expect(step.tool.pieceName).toBe('@activepieces/piece-microsoft-outlook')
        })

        it('never returns connection secrets', async () => {
            const ctx = await seeded()
            await connect({ ctx, pieceName: '@activepieces/piece-slack' })

            const body = await resolve({ ctx, plan: planWith({ steps: [outputStep({ summary: 'Post the summary to the Slack channel', service: 'chat' })] }) })

            expect(JSON.stringify(body)).not.toContain('secret_text')
        })

        it('refuses a project on another platform', async () => {
            const owner = await seeded()
            const stranger = await createTestContext(app!)

            const response = await owner.post('/v1/ai-flow-builder/resolve', {
                projectId: stranger.project.id,
                plan: planWith({ steps: [outputStep({ summary: 'Send a Slack message', service: 'chat' })] }),
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })
})
