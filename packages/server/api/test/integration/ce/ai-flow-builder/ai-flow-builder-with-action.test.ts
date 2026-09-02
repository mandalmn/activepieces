import { AiFlowGenerationStatus, FlowActionType, PackageType, PieceType } from '@activepieces/shared'
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
import { createMockPieceMetadata } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function seedPiece(ctx: TestContext): Promise<{ name: string, actionName: string }> {
    const piece = createMockPieceMetadata({
        platformId: ctx.platform.id,
        packageType: PackageType.REGISTRY,
        pieceType: PieceType.CUSTOM,
        minimumSupportedRelease: '0.0.0',
        maximumSupportedRelease: '999.999.999',
    })
    await db.save('piece_metadata', piece)
    return { name: piece.name, actionName: 'send_message' }
}

describe('AI Flow Builder with a suggested action', () => {
    it('adds the suggested step to the drafted flow', async () => {
        const ctx = await createTestContext(app)
        const piece = await seedPiece(ctx)
        suggestMock.mockResolvedValue({
            action: {
                pieceName: piece.name,
                actionName: piece.actionName,
                displayName: 'Seeded: Send Message',
            },
            skipReason: null,
        })

        const response = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 7 AM send a message',
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json()
        expect(body.status).toBe(AiFlowGenerationStatus.DRAFTED)
        expect(body.suggestedAction.pieceName).toBe(piece.name)
        expect(body.actionSkipReason).toBeNull()

        const flow = await ctx.get(`/v1/flows/${body.flowId}`, { projectId: ctx.project.id })
        const nextAction = flow?.json().version.trigger.nextAction
        expect(nextAction).toBeDefined()
        expect(nextAction.type).toBe(FlowActionType.PIECE)
        expect(nextAction.settings.pieceName).toBe(piece.name)
        expect(nextAction.settings.actionName).toBe(piece.actionName)
    })

    it('still drafts the schedule when the suggester reports a skip reason', async () => {
        const ctx = await createTestContext(app)
        suggestMock.mockResolvedValue({ action: null, skipReason: 'NO_AI_PROVIDER' })

        const response = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every Monday at 9 send a message',
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json()
        expect(body.status).toBe(AiFlowGenerationStatus.DRAFTED)
        expect(body.flowId).toHaveLength(21)
        expect(body.actionSkipReason).toBe('NO_AI_PROVIDER')
    })

    it('still returns a drafted flow when the suggester throws', async () => {
        const ctx = await createTestContext(app)
        suggestMock.mockRejectedValue(new Error('provider exploded'))

        const response = await ctx.post('/v1/ai-flow-builder/generate', {
            projectId: ctx.project.id,
            prompt: 'Every day at 8 AM send a message',
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
    })
})
