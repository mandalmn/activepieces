import {
    AiFlowGenerationStatus,
    ConnectionBindingReason,
    ConnectionBindingStatus,
    ResolveWorkflowPlanStatus,
    WORKFLOW_PLAN_VERSION,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { vi } from 'vitest'

const suggestMock = vi.fn()

vi.mock('../../../../src/app/ai-flow-builder/ai-flow-action-suggester', () => ({
    aiFlowActionSuggester: () => ({
        suggest: (...args: unknown[]) => suggestMock(...args),
    }),
}))

import { db } from '../../../helpers/db'
import { createMockConnection } from '../../../helpers/mocks'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const GMAIL = '@activepieces/piece-gmail'
const TELEGRAM = '@activepieces/piece-telegram-bot'
const SLACK = '@activepieces/piece-slack'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(() => {
    suggestMock.mockReset()
})

async function seeded(): Promise<TestContext> {
    const ctx = await createTestContext(app!)
    await resolverPieces.seed({ platformId: ctx.platform.id })
    return ctx
}

async function connect({ ctx, pieceName, displayName }: { ctx: TestContext, pieceName: string, displayName: string }): Promise<string> {
    const connection = createMockConnection({
        projectIds: [ctx.project.id],
        platformId: ctx.platform.id,
        pieceName,
        displayName,
    }, ctx.user.id)
    await db.save('app_connection', connection)
    return connection.externalId
}

function planFor({ summary, service }: { summary: string, service: string | null }) {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Credential binding',
        description: '',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 07:00',
            service: null,
            schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 07:00' },
        },
        steps: [{ id: 'deliver', kind: WorkflowStepKind.OUTPUT, summary, service, dependsOn: [] }],
    }
}

async function resolveStep({ ctx, summary, service }: { ctx: TestContext, summary: string, service: string | null }) {
    const response = await ctx.post('/v1/ai-flow-builder/resolve', { projectId: ctx.project.id, plan: planFor({ summary, service }) })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    return response?.json().plan.steps[0]
}

describe('Credential auto-binding', () => {
    it('binds the single Gmail connection with no further questions', async () => {
        const ctx = await seeded()
        const externalId = await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })

        const step = await resolveStep({ ctx, summary: 'Send the renewal report by Gmail', service: 'email' })

        expect(step.tool.connection).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.ONLY_ACCOUNT_CONNECTED,
            externalId,
            displayName: 'Gmail Personal',
        })
    })

    it('asks which account to use when personal and work Gmail both exist', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Work' })

        const step = await resolveStep({ ctx, summary: 'Send the renewal report by Gmail', service: 'email' })

        expect(step.tool.connection.status).toBe(ConnectionBindingStatus.NEEDS_SELECTION)
        expect(step.tool.connection.externalId).toBeNull()
        expect(step.tool.connection.options.map((option: { displayName: string }) => option.displayName).sort()).toEqual(['Gmail Personal', 'Gmail Work'])
    })

    it('binds the work account when the request asks for it by name', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        const workId = await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Work' })

        const step = await resolveStep({ ctx, summary: 'Send the renewal report from my work Gmail', service: 'email' })

        expect(step.tool.connection).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.NAMED_IN_REQUEST,
            externalId: workId,
            displayName: 'Gmail Work',
        })
    })

    it('reports a missing Telegram connection without blocking the rest of the plan', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: {
                ...planFor({ summary: 'Send the result to my Telegram', service: 'chat' }),
                steps: [
                    { id: 'notify', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result to my Telegram', service: 'chat', dependsOn: [] },
                    { id: 'archive', kind: WorkflowStepKind.OUTPUT, summary: 'Send the renewal report by Gmail', service: 'email', dependsOn: ['notify'] },
                ],
            },
        })

        const body = response?.json()
        expect(body.status).toBe(ResolveWorkflowPlanStatus.RESOLVED)
        expect(body.plan.steps[0].tool).toMatchObject({
            pieceName: TELEGRAM,
            connection: { status: ConnectionBindingStatus.MISSING, reason: ConnectionBindingReason.NO_ACCOUNT_CONNECTED },
        })
        expect(body.plan.steps[1].tool.connection.status).toBe(ConnectionBindingStatus.BOUND)
    })

    it('binds the single Telegram connection', async () => {
        const ctx = await seeded()
        const externalId = await connect({ ctx, pieceName: TELEGRAM, displayName: 'Telegram Personal' })
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        await connect({ ctx, pieceName: SLACK, displayName: 'Slack Work' })

        const step = await resolveStep({ ctx, summary: 'Send the result to my Telegram', service: 'chat' })

        expect(step.tool.connection).toMatchObject({ status: ConnectionBindingStatus.BOUND, externalId, displayName: 'Telegram Personal' })
    })

    it('asks which Slack account to use when several are connected', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: SLACK, displayName: 'Slack Work' })
        await connect({ ctx, pieceName: SLACK, displayName: 'Slack Support' })

        const step = await resolveStep({ ctx, summary: 'Post the summary to the Slack channel', service: 'chat' })

        expect(step.tool.connection.status).toBe(ConnectionBindingStatus.NEEDS_SELECTION)
        expect(step.tool.connection.options).toHaveLength(2)
    })

    it('marks a piece that needs no account as not requiring one', async () => {
        const ctx = await seeded()

        const step = await resolveStep({ ctx, summary: 'Send an HTTP request to the partner pricing API', service: 'web api' })

        expect(step.tool.connection).toMatchObject({
            status: ConnectionBindingStatus.NOT_REQUIRED,
            reason: ConnectionBindingReason.PIECE_NEEDS_NO_ACCOUNT,
        })
    })

    it('never returns a credential value in the resolve response', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })

        const response = await ctx.post('/v1/ai-flow-builder/resolve', {
            projectId: ctx.project.id,
            plan: planFor({ summary: 'Send the renewal report by Gmail', service: 'email' }),
        })

        const serialised = JSON.stringify(response?.json())
        expect(serialised).not.toContain('secret_text')
        expect(serialised).not.toContain('access_token')
        expect(serialised).not.toContain('refresh_token')
        expect(serialised).not.toContain('client_secret')
        expect(serialised).not.toContain('"value"')
    })

    it('puts the bound connection on the generated flow step', async () => {
        const ctx = await seeded()
        const externalId = await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        suggestMock.mockResolvedValue({ action: { pieceName: GMAIL, actionName: 'send_email', displayName: 'Gmail: Send Email' }, skipReason: null })

        const generated = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send the renewal report by Gmail',
        })
        expect(generated?.json().status).toBe(AiFlowGenerationStatus.DRAFTED)

        const flow = await ctx.get(`/v1/flows/${generated?.json().flowId}`, { projectId: ctx.project.id })

        expect(flow?.json().version.trigger.nextAction.settings.input).toEqual({ auth: `{{connections['${externalId}']}}` })
    })

    it('leaves the generated step unbound rather than guessing between two accounts', async () => {
        const ctx = await seeded()
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Work' })
        suggestMock.mockResolvedValue({ action: { pieceName: GMAIL, actionName: 'send_email', displayName: 'Gmail: Send Email' }, skipReason: null })

        const generated = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send the renewal report by Gmail',
        })
        const flow = await ctx.get(`/v1/flows/${generated?.json().flowId}`, { projectId: ctx.project.id })

        expect(flow?.json().version.trigger.nextAction.settings.input).toEqual({})
    })

    it('still generates the flow when the piece has no connection at all', async () => {
        const ctx = await seeded()
        suggestMock.mockResolvedValue({ action: { pieceName: TELEGRAM, actionName: 'send_text_message', displayName: 'Telegram: Send Text Message' }, skipReason: null })

        const generated = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send the result to my Telegram',
        })

        expect(generated?.json().status).toBe(AiFlowGenerationStatus.DRAFTED)
        expect(generated?.json().flowId).toHaveLength(21)
    })

    it('reuses the account this project already wired into an earlier flow', async () => {
        const ctx = await seeded()
        const firstId = await connect({ ctx, pieceName: SLACK, displayName: 'Slack Alpha' })
        suggestMock.mockResolvedValue({ action: { pieceName: SLACK, actionName: 'send_channel_message', displayName: 'Slack: Send Message To A Channel' }, skipReason: null })

        const generated = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM post the summary to the Slack channel',
        })
        expect(generated?.json().status).toBe(AiFlowGenerationStatus.DRAFTED)

        await connect({ ctx, pieceName: SLACK, displayName: 'Slack Beta' })
        const step = await resolveStep({ ctx, summary: 'Post the renewal summary to the Slack channel', service: 'chat' })

        expect(step.tool.connection).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.ALREADY_USED_BY_THIS_PROJECT,
            externalId: firstId,
            displayName: 'Slack Alpha',
        })
    })

    it('binds the same account in the preview as it writes into the flow', async () => {
        const ctx = await seeded()
        const externalId = await connect({ ctx, pieceName: GMAIL, displayName: 'Gmail Personal' })
        suggestMock.mockResolvedValue({ action: { pieceName: GMAIL, actionName: 'send_email', displayName: 'Gmail: Send Email' }, skipReason: null })

        const previewed = await resolveStep({ ctx, summary: 'Send the renewal report by Gmail', service: 'email' })
        const generated = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send the renewal report by Gmail',
        })
        const flow = await ctx.get(`/v1/flows/${generated?.json().flowId}`, { projectId: ctx.project.id })

        expect(previewed.tool.connection.externalId).toBe(externalId)
        expect(flow?.json().version.trigger.nextAction.settings.input.auth).toBe(`{{connections['${previewed.tool.connection.externalId}']}}`)
    })

    it('does not bind a connection belonging to another project', async () => {
        const ctx = await seeded()
        const stranger = await createTestContext(app!)
        await connect({ ctx: stranger, pieceName: GMAIL, displayName: 'Gmail Personal' })

        const step = await resolveStep({ ctx, summary: 'Send the renewal report by Gmail', service: 'email' })

        expect(step.tool.connection.status).toBe(ConnectionBindingStatus.MISSING)
    })
})
