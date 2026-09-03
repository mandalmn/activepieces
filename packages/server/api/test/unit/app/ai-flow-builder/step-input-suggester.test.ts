import { PropertyType } from '@activepieces/pieces-framework'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...args: unknown[]) => generateText(...args) }))

const { stepInputSuggester } = await import('../../../../src/app/ai-flow-builder/flow-generation/step-input-suggester')

const log = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger

const piece = { name: '@activepieces/piece-asknews', displayName: 'AskNews' }
const action = {
    displayName: 'Search News',
    props: {
        query: { type: PropertyType.SHORT_TEXT, required: true, displayName: 'Query', description: 'Search query' },
        hoursBack: { type: PropertyType.NUMBER, required: false, displayName: 'Hours Back' },
        method: { type: PropertyType.STATIC_DROPDOWN, required: false, displayName: 'Method', options: { options: [{ label: 'Keyword', value: 'kw' }, { label: 'Natural', value: 'nl' }] } },
        auth: { type: PropertyType.SECRET_TEXT, required: true, displayName: 'Connection' },
        notes: { type: PropertyType.MARKDOWN, required: false, displayName: 'Notes' },
    },
}

function suggest({ earlierStepNames = ['trigger', 'step_1'] }: { earlierStepNames?: string[] } = {}) {
    return stepInputSuggester.suggest({
        model: {} as never,
        prompt: 'every morning summarise this week MCS news and mail it',
        summary: 'Search the news for MCS',
        piece: piece as never,
        action: action as never,
        earlierStepNames,
        log,
    })
}

function replies(value: unknown) {
    generateText.mockResolvedValue({ text: JSON.stringify(value) })
}

beforeEach(() => {
    generateText.mockReset()
})

describe('stepInputSuggester', () => {
    it('fills the properties the model could infer', async () => {
        replies({ query: 'MCS LLC', hoursBack: 168, method: 'kw' })

        await expect(suggest()).resolves.toEqual({ query: 'MCS LLC', hoursBack: 168, method: 'kw' })
    })

    it('never accepts a value that carries a connection', async () => {
        replies({ query: 'MCS', auth: "{{connections['asknews']}}" })

        const filled = await suggest()
        expect(filled).toEqual({ query: 'MCS' })
    })

    it('drops a property the action does not have', async () => {
        replies({ query: 'MCS', madeUpProperty: 'nonsense' })

        await expect(suggest()).resolves.toEqual({ query: 'MCS' })
    })

    it('drops a reference to a step that does not exist yet', async () => {
        replies({ query: "{{step_9['output'].name}}" })

        await expect(suggest()).resolves.toEqual({})
    })

    it('keeps a reference to a step that already ran', async () => {
        replies({ query: "{{step_1['output'].company}}" })

        await expect(suggest()).resolves.toEqual({ query: "{{step_1['output'].company}}" })
    })

    it('leaves the step alone when the model cannot be reached', async () => {
        generateText.mockRejectedValue(new Error('no provider'))

        await expect(suggest()).resolves.toEqual({})
    })

    it('leaves the step alone when the model answers with something that is not JSON', async () => {
        generateText.mockResolvedValue({ text: 'I could not work that out' })

        await expect(suggest()).resolves.toEqual({})
    })

    it('reads a fenced JSON answer', async () => {
        generateText.mockResolvedValue({ text: '```json\n{"query":"MCS"}\n```' })

        await expect(suggest()).resolves.toEqual({ query: 'MCS' })
    })

    it('drops an empty value rather than writing a blank', async () => {
        replies({ query: '', hoursBack: 24 })

        await expect(suggest()).resolves.toEqual({ hoursBack: 24 })
    })
})
