import { describe, expect, it } from 'vitest'
import { describeObject, nameScore } from '../../../../../src/app/ai-flow-builder/resolver/tool-candidate-search'

describe('describeObject', () => {
    it('prefers the curated AI description over the plain one', () => {
        const object = { description: 'Send a message', aiMetadata: { description: 'Posts a message into a Slack channel the whole workspace can read.' } }

        expect(describeObject({ object })).toBe('Posts a message into a Slack channel the whole workspace can read.')
    })

    it('falls back to the plain description when no AI description is curated', () => {
        expect(describeObject({ object: { description: 'Send a message' } })).toBe('Send a message')
    })

    it('returns an empty string when a piece documents neither', () => {
        expect(describeObject({ object: { description: '' } })).toBe('')
    })
})

describe('nameScore', () => {
    it('scores an exact full name match above a partial one', () => {
        const exact = nameScore({ signals: signals({ matched: 2, total: 2 }), base: 100, span: 120 })
        const partial = nameScore({ signals: signals({ matched: 1, total: 2 }), base: 100, span: 120 })

        expect(exact).toBeGreaterThan(partial)
    })

    it('separates a full match from a partial one by more than the description ceiling can close', () => {
        const exact = nameScore({ signals: signals({ matched: 2, total: 2 }), base: 100, span: 120 })
        const partial = nameScore({ signals: signals({ matched: 2, total: 3 }), base: 100, span: 120 })

        expect(exact - partial).toBeGreaterThan(24)
    })

    it('scores nothing when no name token matched', () => {
        expect(nameScore({ signals: signals({ matched: 0, total: 2 }), base: 100, span: 120 })).toBe(0)
    })
})

function signals({ matched, total }: { matched: number, total: number }) {
    return { matchedNameTokens: matched, nameTokenCount: total, descriptionHits: 0, cosine: null, catalogRank: null, semanticRank: null }
}
