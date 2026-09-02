import { extractMustacheTokens, isNil } from '@activepieces/core-utils'

const CONNECTION_TOKEN = /^connections\['[^']+'\]$/
const STEP_TOKEN = /^([a-zA-Z_][a-zA-Z0-9_]*)\['(output|error)'\](.*)$/
const PATH_TAIL = /^(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\]|\['[^']*'\]|\["[^"]*"\])*$/
const PATH_SEGMENT = /\.([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]/g

export const expressionInspector = {
    inspect({ input }: { input: unknown }): InspectedExpression[] {
        return collectStrings({ value: input, path: [] }).flatMap((entry) =>
            extractMustacheTokens(entry.text).map((token) => describe({ propertyPath: entry.path, inner: token.inner })))
    },
}

function describe({ propertyPath, inner }: { propertyPath: string[], inner: string }): InspectedExpression {
    const body = inner.trim()
    const base = { propertyPath: propertyPath.join('.'), body }
    if (body.length === 0 || !isBalanced({ body })) {
        return { ...base, kind: ExpressionKind.MALFORMED, stepName: null, fieldPath: null }
    }
    if (CONNECTION_TOKEN.test(body)) {
        return { ...base, kind: ExpressionKind.CONNECTION, stepName: null, fieldPath: null }
    }
    const stepMatch = STEP_TOKEN.exec(body)
    if (isNil(stepMatch) || !PATH_TAIL.test(stepMatch[3])) {
        return { ...base, kind: ExpressionKind.OPAQUE, stepName: null, fieldPath: null }
    }
    return {
        ...base,
        kind: stepMatch[2] === 'output' ? ExpressionKind.STEP_OUTPUT : ExpressionKind.STEP_ERROR,
        stepName: stepMatch[1],
        fieldPath: fieldPathOf({ tail: stepMatch[3] }),
    }
}

function isBalanced({ body }: { body: string }): boolean {
    const closers: string[] = []
    let quote: string | null = null
    for (const character of body) {
        if (!isNil(quote)) {
            if (character === quote) {
                quote = null
            }
            continue
        }
        if (character === '\'' || character === '"' || character === '`') {
            quote = character
            continue
        }
        if (character === '(' || character === '[' || character === '{') {
            closers.push(character === '(' ? ')' : character === '[' ? ']' : '}')
            continue
        }
        if (character === ')' || character === ']' || character === '}') {
            if (closers.pop() !== character) {
                return false
            }
        }
    }
    return isNil(quote) && closers.length === 0
}

function fieldPathOf({ tail }: { tail: string }): string | null {
    const segments = [...tail.matchAll(PATH_SEGMENT)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4])
    return segments.length === 0 ? null : segments.join('.')
}

function collectStrings({ value, path }: { value: unknown, path: string[] }): CollectedString[] {
    if (typeof value === 'string') {
        return [{ path, text: value }]
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => collectStrings({ value: entry, path: [...path, String(index)] }))
    }
    if (typeof value === 'object' && !isNil(value)) {
        return Object.entries(value).flatMap(([key, entry]) => collectStrings({ value: entry, path: [...path, key] }))
    }
    return []
}

type CollectedString = {
    path: string[]
    text: string
}

export enum ExpressionKind {
    CONNECTION = 'CONNECTION',
    STEP_OUTPUT = 'STEP_OUTPUT',
    STEP_ERROR = 'STEP_ERROR',
    OPAQUE = 'OPAQUE',
    MALFORMED = 'MALFORMED',
}

export type InspectedExpression = {
    propertyPath: string
    body: string
    kind: ExpressionKind
    stepName: string | null
    fieldPath: string | null
}
