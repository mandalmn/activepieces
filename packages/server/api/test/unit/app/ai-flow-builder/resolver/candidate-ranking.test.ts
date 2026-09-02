import { ToolResolutionConfidence, WorkflowStepKind } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { candidateRanking } from '../../../../../src/app/ai-flow-builder/resolver/candidate-ranking'
import { ToolCandidate } from '../../../../../src/app/ai-flow-builder/resolver/tool-candidate-search'

function candidate(overrides: Partial<ToolCandidate> = {}): ToolCandidate {
    return {
        pieceName: '@activepieces/piece-slack',
        pieceVersion: '1.0.0',
        pieceDisplayName: 'Slack',
        pieceDescription: 'Channel-based messaging platform',
        pieceCategories: [],
        objectName: 'send_channel_message',
        objectDisplayName: 'Send Message To A Channel',
        objectDescription: 'Send a message to a Slack channel',
        requiresConnection: true,
        connectionAvailable: false,
        classification: 'WRITE',
        audience: 'both',
        requiredProperties: ['channel', 'text'],
        signals: { matchedNameTokens: 0, nameTokenCount: 2, descriptionHits: 0, cosine: null, catalogRank: null, semanticRank: null },
        ...overrides,
    }
}

function scoreOf({ candidates, intentTokens, stepKind = WorkflowStepKind.OUTPUT }: { candidates: ToolCandidate[], intentTokens: string[], stepKind?: WorkflowStepKind | null }) {
    return candidateRanking.rank({ candidates, intentTokens, stepKind })
}

describe('candidateRanking', () => {
    it('puts the app the plan named ahead of an equally relevant rival', () => {
        const named = candidate({ pieceName: '@activepieces/piece-telegram-bot', pieceDisplayName: 'Telegram Bot', objectName: 'send_text_message', objectDisplayName: 'Send Text Message', objectDescription: 'Send a text message to a Telegram chat', signals: { matchedNameTokens: 2, nameTokenCount: 2, descriptionHits: 0, cosine: null, catalogRank: 0, semanticRank: null } })
        const rival = candidate({ objectDescription: 'Send a message to a Slack channel' })

        const [top] = scoreOf({ candidates: [rival, named], intentTokens: ['send', 'message', 'telegram'] })

        expect(top.candidate.pieceName).toBe('@activepieces/piece-telegram-bot')
    })

    it('prefers the app the project already has a connection for', () => {
        const connected = candidate({ pieceName: '@activepieces/piece-microsoft-outlook', pieceDisplayName: 'Microsoft Outlook', objectName: 'send-email', objectDisplayName: 'Send Email', objectDescription: 'Send an email from Outlook', connectionAvailable: true })
        const unconnected = candidate({ pieceName: '@activepieces/piece-gmail', pieceDisplayName: 'Gmail', objectName: 'send_email', objectDisplayName: 'Send Email', objectDescription: 'Send an email through Gmail' })

        const [top] = scoreOf({ candidates: [unconnected, connected], intentTokens: ['send', 'email'] })

        expect(top.candidate.pieceName).toBe('@activepieces/piece-microsoft-outlook')
    })

    it('penalises the generic HTTP piece against a native match', () => {
        const native = candidate({ objectDescription: 'Send a message to a Slack channel' })
        const generic = candidate({ pieceName: '@activepieces/piece-http', pieceDisplayName: 'HTTP', objectName: 'send_request', objectDisplayName: 'Send HTTP request', objectDescription: 'Send HTTP request', requiresConnection: false, requiredProperties: ['method', 'url', 'headers'] })

        const ranked = scoreOf({ candidates: [generic, native], intentTokens: ['send', 'message', 'channel'] })

        expect(ranked[0].candidate.pieceName).toBe('@activepieces/piece-slack')
        expect(ranked[1].score).toBeLessThan(ranked[0].score)
    })

    it('prefers a read action for a fetch step and a write action for an output step', () => {
        const read = candidate({ objectName: 'sheets_find_rows', objectDisplayName: 'Find Rows', objectDescription: 'Find rows in a spreadsheet', classification: 'SEARCH' })
        const write = candidate({ objectName: 'insert_row', objectDisplayName: 'Add Row', objectDescription: 'Append a row to a spreadsheet', classification: 'WRITE' })

        const fetching = scoreOf({ candidates: [write, read], intentTokens: ['rows', 'spreadsheet'], stepKind: WorkflowStepKind.FETCH })
        const outputting = scoreOf({ candidates: [read, write], intentTokens: ['row', 'spreadsheet'], stepKind: WorkflowStepKind.OUTPUT })

        expect(fetching[0].candidate.objectName).toBe('sheets_find_rows')
        expect(outputting[0].candidate.objectName).toBe('insert_row')
    })

    it('uses the semantic cosine when one is available', () => {
        const strong = candidate({ objectName: 'send_channel_message', signals: { matchedNameTokens: 0, nameTokenCount: 2, descriptionHits: 0, cosine: 0.9, catalogRank: null, semanticRank: 0 } })
        const weak = candidate({ objectName: 'send_direct_message', signals: { matchedNameTokens: 0, nameTokenCount: 2, descriptionHits: 0, cosine: 0.4, catalogRank: null, semanticRank: 1 } })

        const [top] = scoreOf({ candidates: [weak, strong], intentTokens: [] })

        expect(top.candidate.objectName).toBe('send_channel_message')
    })

    it('does not penalise an action marked human only, because a flow step is built for a person', () => {
        const humanOnly = candidate({ objectName: 'upload_onedrive_file', objectDisplayName: 'Upload File', objectDescription: 'Upload a file to a OneDrive folder', audience: 'human' })
        const machine = candidate({ objectName: 'upload_other_file', objectDisplayName: 'Upload File', objectDescription: 'Upload a file to a OneDrive folder', audience: 'ai' })

        const ranked = scoreOf({ candidates: [humanOnly, machine], intentTokens: ['upload', 'file'] })

        expect(ranked[0].score).toBe(ranked[1].score)
    })

    it('ranks the app whose full name the plan gave above a rival sharing only the vendor word', () => {
        const exact = candidate({ pieceName: '@activepieces/piece-microsoft-outlook', pieceDisplayName: 'Microsoft Outlook', objectName: 'send-email', objectDisplayName: 'Send Email', objectDescription: 'Send an email from Outlook', signals: { matchedNameTokens: 2, nameTokenCount: 2, descriptionHits: 0, cosine: null, catalogRank: null, semanticRank: null } })
        const sibling = candidate({ pieceName: '@activepieces/piece-microsoft-planner', pieceDisplayName: 'Microsoft Planner', objectName: 'create_plan_task', objectDisplayName: 'Create Plan Task', objectDescription: 'Create a task in a Microsoft Planner plan', signals: { matchedNameTokens: 1, nameTokenCount: 2, descriptionHits: 3, cosine: null, catalogRank: 0, semanticRank: null } })

        const [top] = scoreOf({ candidates: [sibling, exact], intentTokens: ['send', 'report', 'microsoft', 'outlook', 'email'] })

        expect(top.candidate.pieceName).toBe('@activepieces/piece-microsoft-outlook')
    })

    it('reports HIGH only when the leader is both strong and clear of the runner up', () => {
        const leader = candidate({ signals: { matchedNameTokens: 1, nameTokenCount: 1, descriptionHits: 2, cosine: null, catalogRank: 0, semanticRank: null } })
        const trailer = candidate({ pieceName: '@activepieces/piece-gmail', objectName: 'send_email', objectDisplayName: 'Send Email', objectDescription: 'unrelated bookkeeping', requiredProperties: [] })

        const ranked = scoreOf({ candidates: [leader, trailer], intentTokens: ['send', 'message', 'slack', 'channel'] })

        expect(candidateRanking.confidenceOf({ ranked })).toBe(ToolResolutionConfidence.HIGH)
    })

    it('reports MEDIUM when two workable candidates are neck and neck', () => {
        const first = candidate({ objectName: 'send_channel_message', objectDisplayName: 'Send Message To A Channel', connectionAvailable: true })
        const second = candidate({ objectName: 'send_direct_message', objectDisplayName: 'Send Message To A User', connectionAvailable: true })

        const ranked = scoreOf({ candidates: [first, second], intentTokens: ['send', 'message'] })

        expect(ranked[0].score - ranked[1].score).toBeLessThan(12)
        expect(candidateRanking.confidenceOf({ ranked })).toBe(ToolResolutionConfidence.MEDIUM)
    })

    it('reports LOW when two weak candidates tie with no connection to break it', () => {
        const first = candidate({ objectName: 'send_channel_message', objectDisplayName: 'Send Message To A Channel' })
        const second = candidate({ objectName: 'send_direct_message', objectDisplayName: 'Send Message To A User' })

        const ranked = scoreOf({ candidates: [first, second], intentTokens: ['send', 'message'] })

        expect(candidateRanking.confidenceOf({ ranked })).toBe(ToolResolutionConfidence.LOW)
    })

    it('reports LOW when nothing scores above the floor', () => {
        const irrelevant = candidate({ objectDisplayName: 'Archive Ledger', objectDescription: 'Archive an accounting ledger', classification: undefined, requiredProperties: ['a', 'b', 'c', 'd', 'e', 'f'] })

        const ranked = scoreOf({ candidates: [irrelevant], intentTokens: ['upload', 'photograph'] })

        expect(candidateRanking.confidenceOf({ ranked })).toBe(ToolResolutionConfidence.LOW)
    })

    it('reports LOW for an empty candidate list', () => {
        expect(candidateRanking.confidenceOf({ ranked: [] })).toBe(ToolResolutionConfidence.LOW)
    })

    it('records the signals that produced each score', () => {
        const [top] = scoreOf({ candidates: [candidate({ connectionAvailable: true })], intentTokens: ['send', 'message'] })

        expect(top.signals).toContain('connected:14')
        expect(top.score).toBeGreaterThan(0)
    })
})
