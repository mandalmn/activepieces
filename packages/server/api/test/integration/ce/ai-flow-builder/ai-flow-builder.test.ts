import { AiFlowGenerationStatus, WORKFLOW_PLAN_VERSION, WorkflowStepKind, WorkflowTriggerKind } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { resolverPieces } from '../../../helpers/resolver-pieces'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const mongolianPrompt = 'би өглөө болгон 7 цагт sukhtumur@mandal.mn руу сайн уу гэж явуулмаар байна'

const planFor = ({ cronExpression }: { cronExpression: string }) => ({
    version: WORKFLOW_PLAN_VERSION,
    name: 'Өглөөний мэндчилгээ',
    description: 'Өдөр бүр өглөө мэндчилгээ илгээнэ',
    trigger: {
        kind: WorkflowTriggerKind.SCHEDULE,
        summary: 'Өдөр бүр 07:00 цагт',
        service: null,
        schedule: { cronExpression, timezone: 'Asia/Ulaanbaatar', description: 'өдөр бүр 07:00 цагт' },
    },
    steps: [
        { id: 'compose', kind: WorkflowStepKind.TRANSFORM, summary: 'Мэндчилгээний текст бэлтгэх', service: null, dependsOn: [] },
        { id: 'deliver', kind: WorkflowStepKind.OUTPUT, summary: 'Имэйл илгээх', service: 'email', dependsOn: ['compose'] },
    ],
})

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('AI Flow Builder API', () => {
    describe('Generate endpoint', () => {
        it('drafts a real flow from a scheduled prompt', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'Every day at 7 AM send me the gold price change',
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.status).toBe(AiFlowGenerationStatus.DRAFTED)
            expect(body.flowId).toHaveLength(21)
            expect(body.schedule).toMatchObject({
                cronExpression: '0 7 * * *',
                timezone: 'UTC',
            })
        })

        it('names the drafted flow after the prompt', async () => {
            const ctx = await createTestContext(app!)

            const generated = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'Every Monday at 9 send the weekly report',
            })
            const flowId = generated?.json().flowId

            const flow = await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id })

            expect(flow?.statusCode).toBe(StatusCodes.OK)
            expect(flow?.json().version.displayName).toBe('Every Monday at 9 send the weekly report')
        })

        it('asks for more detail when no schedule can be inferred', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'post something to slack when a row changes',
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.status).toBe(AiFlowGenerationStatus.NEEDS_MORE_DETAIL)
            expect(body.flowId).toBeNull()
            expect(body.schedule).toBeNull()
        })

        it('rejects an empty prompt', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: '   ',
            })

            expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
        })
    })

    describe('Generate endpoint with a plan', () => {
        async function seeded(): Promise<TestContext> {
            const context = await createTestContext(app!)
            await resolverPieces.seed({ platformId: context.platform.id })
            return context
        }

        it('uses the schedule the planner interpreted, from a prompt the parser cannot read', async () => {
            const ctx = await seeded()

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: mongolianPrompt,
                plan: planFor({ cronExpression: '0 7 * * *' }),
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.status).toBe(AiFlowGenerationStatus.DRAFTED)
            expect(body.flowId).toHaveLength(21)
            expect(body.schedule).toMatchObject({
                cronExpression: '0 7 * * *',
                timezone: 'Asia/Ulaanbaatar',
            })
        })

        it('names the drafted flow after the plan, not the raw prompt', async () => {
            const ctx = await seeded()

            const generated = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: mongolianPrompt,
                plan: planFor({ cronExpression: '0 7 * * *' }),
            })
            const flowId = generated?.json().flowId

            const flow = await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id })

            expect(flow?.json().version.displayName).toBe('Өглөөний мэндчилгээ')
        })

        it('puts the planned cron on the schedule trigger', async () => {
            const ctx = await seeded()

            const generated = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: mongolianPrompt,
                plan: planFor({ cronExpression: '30 6 * * 1' }),
            })
            const flowId = generated?.json().flowId

            const flow = await ctx.get(`/v1/flows/${flowId}`, { projectId: ctx.project.id })

            expect(flow?.json().version.trigger.settings.input).toMatchObject({
                cronExpression: '30 6 * * 1',
                timezone: 'Asia/Ulaanbaatar',
            })
        })

        it('ignores a plan whose schedule does not survive validation', async () => {
            const ctx = await seeded()

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: mongolianPrompt,
                plan: planFor({ cronExpression: 'whenever I feel like it' }),
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const body = response?.json()
            expect(body.status).toBe(AiFlowGenerationStatus.NEEDS_MORE_DETAIL)
            expect(body.flowId).toBeNull()
        })

        it('still reads the prompt when no plan is sent', async () => {
            const ctx = await seeded()

            const response = await ctx.post('/v1/ai-flow-builder/generate', {
                projectId: ctx.project.id,
                prompt: 'Every day at 7 AM send me the gold price change',
                plan: null,
            })

            expect(response?.json().schedule).toMatchObject({ cronExpression: '0 7 * * *', timezone: 'UTC' })
        })
    })
})
