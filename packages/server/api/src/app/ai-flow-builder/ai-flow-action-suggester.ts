import { isNil, tryCatch } from '@activepieces/core-utils'
import { AiFlowActionSkipReason, AiFlowSuggestedAction } from '@activepieces/shared'
import { generateText, LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import { aiModelResolver, ModelResolutionFailure } from './ai-model-resolver'

const SUGGEST_TIMEOUT_MS = 20_000
const NO_MATCH = 'none'

export const aiFlowActionSuggester = (log: FastifyBaseLogger): AiFlowActionSuggester => ({
    async suggest({ projectId, platformId, prompt }: SuggestParams): Promise<SuggestionOutcome> {
        const { data, error } = await tryCatch(() => resolveSuggestion({ projectId, platformId, prompt, log }))
        if (!isNil(error) || isNil(data)) {
            log.warn({ error, projectId }, '[aiFlowBuilder#suggest] Suggestion failed, keeping the schedule-only draft')
            return { action: null, skipReason: AiFlowActionSkipReason.SUGGESTION_FAILED }
        }
        return data
    },
})

async function resolveSuggestion({ projectId, platformId, prompt, log }: SuggestParams & { log: FastifyBaseLogger }): Promise<SuggestionOutcome> {
    const resolved = await aiModelResolver(log).resolveTextModel({ projectId, platformId })
    if (isNil(resolved.model)) {
        log.info({ projectId, failure: resolved.failure }, '[aiFlowBuilder#suggest] No usable text model, drafting the schedule only')
        return { action: null, skipReason: resolved.failure === ModelResolutionFailure.NO_TEXT_MODEL ? AiFlowActionSkipReason.NO_TEXT_MODEL : AiFlowActionSkipReason.NO_AI_PROVIDER }
    }

    const pieces = await pieceMetadataService(log).list({ projectId, platformId, includeHidden: false })
    if (pieces.length === 0) {
        log.info({ projectId }, '[aiFlowBuilder#suggest] No pieces available to choose from')
        return { action: null, skipReason: AiFlowActionSkipReason.NO_MATCHING_ACTION }
    }

    const pieceReply = await askModel({
        model: resolved.model,
        prompt,
        system: buildPiecePrompt({ pieces }),
    })
    const piece = pickByLineNumber({ reply: pieceReply, options: pieces })
    if (isNil(piece)) {
        log.info({ projectId }, '[aiFlowBuilder#suggest] Model matched no piece')
        return { action: null, skipReason: AiFlowActionSkipReason.NO_MATCHING_ACTION }
    }

    const full = await pieceMetadataService(log).get({ name: piece.name, projectId, platformId })
    const actions = isNil(full) ? [] : Object.values(full.actions)
    if (actions.length === 0) {
        return { action: null, skipReason: AiFlowActionSkipReason.NO_MATCHING_ACTION }
    }

    const actionReply = await askModel({
        model: resolved.model,
        prompt,
        system: buildActionPrompt({ pieceDisplayName: piece.displayName, actions }),
    })
    const chosen = pickByLineNumber({ reply: actionReply, options: actions })
    if (isNil(chosen)) {
        return { action: null, skipReason: AiFlowActionSkipReason.NO_MATCHING_ACTION }
    }

    return {
        action: {
            pieceName: piece.name,
            actionName: chosen.name,
            displayName: `${piece.displayName}: ${chosen.displayName}`,
        },
        skipReason: null,
    }
}

async function askModel({ model, system, prompt }: { model: LanguageModel, system: string, prompt: string }): Promise<string> {
    const result = await withTimeout({
        promise: generateText({ model, system, prompt }),
        ms: SUGGEST_TIMEOUT_MS,
    })
    return result.text
}

function buildPiecePrompt({ pieces }: { pieces: { name: string, displayName: string }[] }): string {
    const lines = pieces.map((piece, index) => `${index + 1}. ${piece.displayName}`)
    return [
        'You choose which app best matches the automation the user described.',
        `Answer with exactly one line number from the list, or "${NO_MATCH}" when nothing fits.`,
        'Prefer the app the user named. Do not explain. Do not add any other text.',
        'Available apps:',
        ...lines,
    ].join('\n')
}

function buildActionPrompt({ pieceDisplayName, actions }: { pieceDisplayName: string, actions: { name: string, displayName: string }[] }): string {
    const lines = actions.map((action, index) => `${index + 1}. ${action.displayName}`)
    return [
        `You choose which ${pieceDisplayName} step best matches the automation the user described.`,
        `Answer with exactly one line number from the list, or "${NO_MATCH}" when nothing fits.`,
        'Do not explain. Do not add any other text.',
        'Available steps:',
        ...lines,
    ].join('\n')
}

function pickByLineNumber<T>({ reply, options }: { reply: string, options: T[] }): T | null {
    const trimmed = reply.trim().toLowerCase()
    if (trimmed.length === 0 || trimmed.startsWith(NO_MATCH)) {
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

async function withTimeout<T>({ promise, ms }: { promise: Promise<T>, ms: number }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Suggestion timed out after ${ms}ms`)), ms)
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

type SuggestParams = {
    projectId: string
    platformId: string
    prompt: string
}

type SuggestionOutcome = {
    action: AiFlowSuggestedAction | null
    skipReason: AiFlowActionSkipReason | null
}

type AiFlowActionSuggester = {
    suggest(params: SuggestParams): Promise<SuggestionOutcome>
}
