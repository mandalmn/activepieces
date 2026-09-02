import { isNil, tryCatch } from '@activepieces/core-utils'
import { MAX_TOOL_SHORTLIST, ResolvedToolKind } from '@activepieces/shared'
import { generateText, LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { ScoredCandidate } from './candidate-ranking'
import { ToolIntent } from './tool-candidate-search'

const ADJUDICATE_TIMEOUT_MS = 20_000
const NO_MATCH = 'none'
const REFUSAL = /\bnone\b|\bno match\b|\bnothing\b/

export const toolAdjudicator = {
    async choose({ model, intent, ranked, log }: ChooseParams): Promise<ScoredCandidate | null> {
        const shortlist = ranked.slice(0, MAX_TOOL_SHORTLIST)
        if (shortlist.length === 0) {
            return null
        }
        const abort = new AbortController()
        const { data, error } = await tryCatch(() => withTimeout({
            promise: generateText({
                model,
                system: buildAdjudicationPrompt({ intent, shortlist }),
                prompt: intent.summary,
                abortSignal: abort.signal,
            }),
            ms: ADJUDICATE_TIMEOUT_MS,
            onTimeout: () => abort.abort(),
        }))
        if (isNil(data)) {
            log.warn({ error }, '[toolResolver] Adjudication call failed, keeping the ranked order')
            return null
        }
        return pickByLineNumber({ reply: data.text, options: shortlist })
    },
}

function buildAdjudicationPrompt({ intent, shortlist }: { intent: ToolIntent, shortlist: ScoredCandidate[] }): string {
    const noun = intent.kind === ResolvedToolKind.ACTION ? 'step' : 'trigger'
    const lines = shortlist.map(({ candidate }, index) => {
        const connection = !candidate.requiresConnection
            ? 'no connection needed'
            : candidate.connectionAvailable
                ? 'connection ready'
                : 'connection not set up yet'
        const inputs = candidate.requiredProperties.length === 0
            ? 'no required inputs'
            : `required inputs: ${candidate.requiredProperties.join(', ')}`
        const description = candidate.objectDescription.length === 0 ? '' : ` — ${candidate.objectDescription}`
        return `${index + 1}. ${candidate.pieceDisplayName}: ${candidate.objectDisplayName}${description} (${connection}; ${inputs})`
    })
    return [
        `You choose which ${noun} carries out one part of an automation.`,
        `Answer with exactly one line number from the list, or "${NO_MATCH}" when none of them does the job.`,
        'Do not explain. Do not add any other text.',
        '',
        'Rules:',
        '- Prefer the app the request names.',
        '- When two options do the same job, prefer the one whose connection is already set up.',
        '- Prefer a purpose built app over a generic HTTP request.',
        `- Answer "${NO_MATCH}" rather than picking something that only partly fits.`,
        '',
        `The part to carry out: ${intent.summary}`,
        ...(isNil(intent.service) ? [] : [`Kind of system involved: ${intent.service}`]),
        '',
        `Available ${noun}s:`,
        ...lines,
    ].join('\n')
}

function pickByLineNumber<T>({ reply, options }: { reply: string, options: T[] }): T | null {
    const trimmed = reply.trim().toLowerCase()
    if (trimmed.length === 0 || REFUSAL.test(trimmed)) {
        return null
    }
    const match = /\d+/.exec(trimmed)
    if (isNil(match)) {
        return null
    }
    const index = Number.parseInt(match[0], 10) - 1
    if (Number.isNaN(index) || index < 0 || index >= options.length) {
        return null
    }
    return options[index]
}

async function withTimeout<T>({ promise, ms, onTimeout }: { promise: Promise<T>, ms: number, onTimeout: () => void }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            onTimeout()
            reject(new Error(`Adjudication timed out after ${ms}ms`))
        }, ms)
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

type ChooseParams = {
    model: LanguageModel
    intent: ToolIntent
    ranked: ScoredCandidate[]
    log: FastifyBaseLogger
}
