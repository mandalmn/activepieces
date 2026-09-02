import { AIProviderModelType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listForProject = vi.fn()
const getConfigOrThrow = vi.fn()
const listModels = vi.fn()
const listPieces = vi.fn()
const getPiece = vi.fn()
const generateTextMock = vi.fn()

vi.mock('../../../../src/app/ai/ai-provider-service', () => ({
    aiProviderService: () => ({
        listForProject: (...args: unknown[]) => listForProject(...args),
        listModels: (...args: unknown[]) => listModels(...args),
        getConfigOrThrow: (...args: unknown[]) => getConfigOrThrow(...args),
    }),
}))

vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: () => ({
        list: (...args: unknown[]) => listPieces(...args),
        get: (...args: unknown[]) => getPiece(...args),
    }),
}))

vi.mock('@activepieces/server-utils', () => ({
    agentAiUtils: { createChatModel: () => ({}) },
}))

vi.mock('ai', () => ({
    generateText: (...args: unknown[]) => generateTextMock(...args),
}))

import { aiFlowActionSuggester } from '../../../../src/app/ai-flow-builder/ai-flow-action-suggester'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
const params = { projectId: 'project-1', platformId: 'platform-1', prompt: 'post a message to slack' }

const configuredProviders = [{ provider: 'OPENAI', name: 'OpenAI', enabledForChat: false, keys: [{ id: 'config-1', name: 'key' }] }]
const providerConfig = { provider: 'OPENAI', configId: 'config-1', auth: {}, config: {}, platformId: 'platform-1' }
const textModel = { id: 'gpt-test', name: 'gpt-test', type: AIProviderModelType.TEXT }
// Stage 1 sees summaries (`actions` is a COUNT); stage 2 fetches the full piece.
const piecesWithSlack = [
    { name: '@activepieces/piece-slack', displayName: 'Slack', actions: 1, triggers: 0 },
]
const fullSlack = {
    name: '@activepieces/piece-slack',
    displayName: 'Slack',
    actions: { send_message: { name: 'send_message', displayName: 'Send Message' } },
    triggers: {},
}

describe('aiFlowActionSuggester', () => {
    beforeEach(() => {
        listForProject.mockReset()
        getConfigOrThrow.mockReset()
        listModels.mockReset()
        listPieces.mockReset()
        getPiece.mockReset()
        generateTextMock.mockReset()
    })

    it('returns null when no AI provider is configured at all', async () => {
        listForProject.mockResolvedValue([])
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('returns null when the provider exposes no text model', async () => {
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([{ id: 'dall-e', name: 'dall-e', type: AIProviderModelType.IMAGE }])
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
    })

    it('returns null when there are no candidate pieces', async () => {
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue([])
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
    })

    it('resolves the picked line number to a real piece action', async () => {
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue(piecesWithSlack)
        getPiece.mockResolvedValue(fullSlack)
        generateTextMock.mockResolvedValue({ text: '1' })
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toEqual({
            pieceName: '@activepieces/piece-slack',
            actionName: 'send_message',
            displayName: 'Slack: Send Message',
        })
    })

    it('uses a provider that is not enabled for chat', async () => {
        listForProject.mockResolvedValue([{ provider: 'OPENAI', name: 'OpenAI', enabledForChat: false, keys: [{ id: 'config-1', name: 'key' }] }])
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue(piecesWithSlack)
        getPiece.mockResolvedValue(fullSlack)
        generateTextMock.mockResolvedValue({ text: '1' })

        const outcome = await aiFlowActionSuggester(log).suggest(params)

        expect(outcome.skipReason).toBeNull()
        expect(outcome.action?.pieceName).toBe('@activepieces/piece-slack')
    })

    it('reports NO_TEXT_MODEL when a provider exists but exposes no text model', async () => {
        listForProject.mockResolvedValue([{ provider: 'OPENAI', name: 'OpenAI', enabledForChat: false, keys: [{ id: 'config-1', name: 'key' }] }])
        listModels.mockResolvedValue([{ id: 'dall-e', name: 'dall-e', type: AIProviderModelType.IMAGE }])

        const outcome = await aiFlowActionSuggester(log).suggest(params)

        expect(outcome.action).toBeNull()
        expect(outcome.skipReason).toBe('NO_TEXT_MODEL')
    })

    it('can reach a piece far past the old 25-piece cutoff', async () => {
        // Regression: the candidate list used to be sliced to the first 25 pieces
        // alphabetically, so anything from Microsoft onwards was unreachable.
        const catalogue = Array.from({ length: 200 }, (_unused, index) => ({
            name: `@activepieces/piece-${index}`,
            displayName: `Piece ${index}`,
            actions: 1,
            triggers: 0,
        }))
        catalogue[142] = { name: '@activepieces/piece-microsoft-outlook', displayName: 'Microsoft Outlook', actions: 1, triggers: 0 }
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue(catalogue)
        getPiece.mockResolvedValue({
            name: '@activepieces/piece-microsoft-outlook',
            displayName: 'Microsoft Outlook',
            actions: { send_email: { name: 'send_email', displayName: 'Send Email' } },
            triggers: {},
        })
        generateTextMock
            .mockResolvedValueOnce({ text: '143' })
            .mockResolvedValueOnce({ text: '1' })

        const outcome = await aiFlowActionSuggester(log).suggest(params)

        expect(outcome.action).toEqual({
            pieceName: '@activepieces/piece-microsoft-outlook',
            actionName: 'send_email',
            displayName: 'Microsoft Outlook: Send Email',
        })
    })

    it('returns null when the model answers none', async () => {
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue(piecesWithSlack)
        getPiece.mockResolvedValue(fullSlack)
        generateTextMock.mockResolvedValue({ text: 'none' })
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
    })

    it('returns null when the model picks an out-of-range line', async () => {
        listForProject.mockResolvedValue(configuredProviders)
        getConfigOrThrow.mockResolvedValue(providerConfig)
        listModels.mockResolvedValue([textModel])
        listPieces.mockResolvedValue(piecesWithSlack)
        getPiece.mockResolvedValue(fullSlack)
        generateTextMock.mockResolvedValue({ text: '99' })
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
    })

    it('swallows provider errors so the schedule draft survives', async () => {
        listForProject.mockRejectedValue(new Error('provider exploded'))
        expect((await aiFlowActionSuggester(log).suggest(params)).action).toBeNull()
    })
})
