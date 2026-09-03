import { isNil, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import { PieceMetadataModel, PieceProperty, PropertyType } from '@activepieces/pieces-framework'
import { generateText, LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'

const SUGGEST_TIMEOUT_MS = 25_000
const MAX_OPTIONS_LISTED = 12
const MAX_VALUE_LENGTH = 2_000
const CREDENTIAL_MARKER = /\{\{\s*connections\s*\[[^\]]*\]\s*\}\}/
const INFERABLE_PROPERTY_TYPES = new Set<PropertyType>([
    PropertyType.SHORT_TEXT,
    PropertyType.LONG_TEXT,
    PropertyType.RICH_TEXT,
    PropertyType.NUMBER,
    PropertyType.CHECKBOX,
    PropertyType.DATE_TIME,
    PropertyType.COLOR,
    PropertyType.STATIC_DROPDOWN,
    PropertyType.STATIC_MULTI_SELECT_DROPDOWN,
])

export const stepInputSuggester = {
    async suggest({ model, prompt, summary, piece, action, earlierStepNames, log }: SuggestParams): Promise<Record<string, unknown>> {
        const writable = Object.entries(action.props).filter(([, property]) => INFERABLE_PROPERTY_TYPES.has(property.type))
        if (writable.length === 0) {
            return {}
        }

        const instructions = buildPrompt({ prompt, summary, piece, action, writable, earlierStepNames })
        const { data, error } = await tryCatch(() => withTimeout({
            promise: generateText({ model, prompt: instructions }),
            ms: SUGGEST_TIMEOUT_MS,
        }))
        if (isNil(data)) {
            log.warn({ piece: { name: piece.name }, error }, '[stepInputSuggester] Could not reach the model, leaving the step for the person to fill')
            return {}
        }

        const { data: parsed } = tryCatchSync(() => JSON.parse(stripFences({ text: data.text })))
        if (isNil(parsed) || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {}
        }
        return screen({ suggested: parsed as Record<string, unknown>, writable, earlierStepNames })
    },
}

function buildPrompt({ prompt, summary, piece, action, writable, earlierStepNames }: PromptParams): string {
    return [
        'You configure one step of an automation someone asked for.',
        '',
        `What they asked for: ${prompt}`,
        `What this step is meant to do: ${summary}`,
        `The step runs ${piece.displayName}: ${action.displayName}.`,
        '',
        'Properties you may set:',
        ...writable.map(([name, property]) =>
            `  ${name} (${property.type}${property.required ? ', required' : ''})${optionsOf({ property })}${descriptionOf({ property })}`),
        '',
        earlierStepNames.length === 0
            ? 'No earlier step has produced anything yet, so write plain values only.'
            : `Earlier steps you may read from: ${earlierStepNames.join(', ')}. Reference one as {{step_name['output'].field}}.`,
        '',
        'Rules:',
        '- Answer with a JSON object mapping property name to value, and nothing else.',
        '- Only use property names from the list above.',
        '- Leave out any property whose value you cannot infer from the request. A missing property is better than a guessed one.',
        '- Never write an API key, token, password or account name. The account is already connected.',
        '- Write text in the language the request is written in.',
        '- For a dropdown, use one of the listed values exactly.',
    ].join('\n')
}

function screen({ suggested, writable, earlierStepNames }: ScreenParams): Record<string, unknown> {
    const known = new Map(writable)
    const entries = Object.entries(suggested).filter(([name, value]) => {
        const property = known.get(name)
        if (isNil(property) || isNil(value) || value === '') {
            return false
        }
        if (carriesCredential({ value })) {
            return false
        }
        if (referencesUnknownStep({ value, earlierStepNames })) {
            return false
        }
        return withinLength({ value })
    })
    return Object.fromEntries(entries)
}

function carriesCredential({ value }: { value: unknown }): boolean {
    if (typeof value === 'string') {
        return CREDENTIAL_MARKER.test(value)
    }
    if (Array.isArray(value)) {
        return value.some((entry) => carriesCredential({ value: entry }))
    }
    if (typeof value === 'object' && !isNil(value)) {
        return Object.values(value).some((entry) => carriesCredential({ value: entry }))
    }
    return false
}

function referencesUnknownStep({ value, earlierStepNames }: { value: unknown, earlierStepNames: string[] }): boolean {
    if (typeof value !== 'string') {
        return false
    }
    const referenced = [...value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\[/g)].map((match) => match[1])
    return referenced.some((name) => name !== 'trigger' && !earlierStepNames.includes(name))
}

function withinLength({ value }: { value: unknown }): boolean {
    return JSON.stringify(value).length <= MAX_VALUE_LENGTH
}

function optionsOf({ property }: { property: PieceProperty }): string {
    if (property.type !== PropertyType.STATIC_DROPDOWN && property.type !== PropertyType.STATIC_MULTI_SELECT_DROPDOWN) {
        return ''
    }
    const options = property.options.options
    if (options.length === 0) {
        return ''
    }
    return ` — one of: ${options.slice(0, MAX_OPTIONS_LISTED).map((option) => JSON.stringify(option.value)).join(', ')}`
}

function descriptionOf({ property }: { property: PieceProperty }): string {
    return isNil(property.description) || property.description === '' ? '' : ` — ${property.description}`
}

function stripFences({ text }: { text: string }): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
    return (fenced?.[1] ?? text).trim()
}

async function withTimeout<T>({ promise, ms }: { promise: Promise<T>, ms: number }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Suggesting the step input timed out after ${ms}ms`)), ms)
    })
    try {
        return await Promise.race([promise, expiry])
    }
    finally {
        if (!isNil(timer)) {
            clearTimeout(timer)
        }
    }
}

type PropertyEntry = [string, PieceProperty]

type ScreenParams = {
    suggested: Record<string, unknown>
    writable: PropertyEntry[]
    earlierStepNames: string[]
}

type PromptParams = {
    prompt: string
    summary: string
    piece: PieceMetadataModel
    action: { displayName: string, props: Record<string, PieceProperty> }
    writable: PropertyEntry[]
    earlierStepNames: string[]
}

type SuggestParams = {
    model: LanguageModel
    prompt: string
    summary: string
    piece: PieceMetadataModel
    action: { displayName: string, props: Record<string, PieceProperty> }
    earlierStepNames: string[]
    log: FastifyBaseLogger
}
