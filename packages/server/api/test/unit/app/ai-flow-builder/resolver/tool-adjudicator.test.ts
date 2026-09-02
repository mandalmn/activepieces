import { ResolvedToolKind } from '@activepieces/shared'
import { LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.fn()

vi.mock('ai', () => ({
    generateText: (...args: unknown[]) => generateTextMock(...args),
}))

import { ScoredCandidate } from '../../../../../src/app/ai-flow-builder/resolver/candidate-ranking'
import { toolAdjudicator } from '../../../../../src/app/ai-flow-builder/resolver/tool-adjudicator'
import { ToolCandidate } from '../../../../../src/app/ai-flow-builder/resolver/tool-candidate-search'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger
const model = {} as LanguageModel
const intent = { kind: ResolvedToolKind.ACTION, summary: 'Send the renewal notice to the customer', service: 'email' }

function scored({ pieceName, pieceDisplayName, objectName, objectDisplayName, connectionAvailable = false }: ScoredOverrides): ScoredCandidate {
    const candidate: ToolCandidate = {
        pieceName,
        pieceVersion: '1.0.0',
        pieceDisplayName,
        pieceDescription: '',
        pieceCategories: [],
        objectName,
        objectDisplayName,
        objectDescription: `${objectDisplayName} description`,
        requiresConnection: true,
        connectionAvailable,
        classification: 'WRITE',
        audience: 'both',
        requiredProperties: ['to', 'subject'],
        signals: { matchedNameTokens: 0, nameTokenCount: 2, descriptionHits: 0, cosine: null, catalogRank: null, semanticRank: null },
    }
    return { candidate, score: 30, signals: [] }
}

const shortlist = [
    scored({ pieceName: '@activepieces/piece-gmail', pieceDisplayName: 'Gmail', objectName: 'send_email', objectDisplayName: 'Send Email' }),
    scored({ pieceName: '@activepieces/piece-microsoft-outlook', pieceDisplayName: 'Microsoft Outlook', objectName: 'send-email', objectDisplayName: 'Send Email', connectionAvailable: true }),
]

describe('toolAdjudicator', () => {
    beforeEach(() => {
        generateTextMock.mockReset()
    })

    it('returns the candidate the model picked by line number', async () => {
        generateTextMock.mockResolvedValue({ text: '2' })

        const chosen = await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })

        expect(chosen?.candidate.pieceName).toBe('@activepieces/piece-microsoft-outlook')
    })

    it('abstains when the model answers none', async () => {
        generateTextMock.mockResolvedValue({ text: 'none' })

        expect(await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })).toBeNull()
    })

    it('reads a refusal as a refusal even when it mentions a number', async () => {
        generateTextMock.mockResolvedValue({ text: 'None of these 2 options fit the request.' })

        expect(await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })).toBeNull()
    })

    it('abstains when the model names a line that does not exist', async () => {
        generateTextMock.mockResolvedValue({ text: '9' })

        expect(await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })).toBeNull()
    })

    it('abstains rather than throwing when the provider fails', async () => {
        generateTextMock.mockRejectedValue(new Error('provider exploded'))

        expect(await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })).toBeNull()
    })

    it('does not call the model when there is nothing to choose between', async () => {
        expect(await toolAdjudicator.choose({ model, intent, ranked: [], log })).toBeNull()
        expect(generateTextMock).not.toHaveBeenCalled()
    })

    it('shows the model only the shortlist, never the whole catalog', async () => {
        generateTextMock.mockResolvedValue({ text: '1' })
        const long = Array.from({ length: 40 }, (_unused, index) => scored({
            pieceName: `@activepieces/piece-${index}`,
            pieceDisplayName: `Piece ${index}`,
            objectName: `action_${index}`,
            objectDisplayName: `Action ${index}`,
        }))

        await toolAdjudicator.choose({ model, intent, ranked: long, log })

        const system = generateTextMock.mock.calls[0][0].system
        expect(system).toContain('Action 0')
        expect(system).toContain('Action 7')
        expect(system).not.toContain('Action 8')
    })

    it('tells the model which options are already connected', async () => {
        generateTextMock.mockResolvedValue({ text: '1' })

        await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })

        const system = generateTextMock.mock.calls[0][0].system
        expect(system).toContain('Microsoft Outlook: Send Email')
        expect(system).toContain('connection ready')
        expect(system).toContain('connection not set up yet')
        expect(system).toContain('required inputs: to, subject')
    })

    it('sends the model metadata only, never a credential', async () => {
        generateTextMock.mockResolvedValue({ text: '1' })

        await toolAdjudicator.choose({ model, intent, ranked: shortlist, log })

        const sent = JSON.stringify(generateTextMock.mock.calls[0][0])
        expect(sent).not.toContain('apiKey')
        expect(sent).not.toContain('secret_text')
        expect(sent).not.toContain('sk-')
    })
})

type ScoredOverrides = {
    pieceName: string
    pieceDisplayName: string
    objectName: string
    objectDisplayName: string
    connectionAvailable?: boolean
}
