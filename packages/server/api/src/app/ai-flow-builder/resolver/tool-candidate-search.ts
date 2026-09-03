import { isNil, tryCatch } from '@activepieces/core-utils'
import { ActionBase, PieceMetadataModel, PieceMetadataModelSummary, TriggerBase } from '@activepieces/pieces-framework'
import { PieceCategory, ResolvedToolKind, SuggestionType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { toolSearchService } from '../../tool-search/tool-search.service'
import { ResolutionContext } from './resolution-context'

const MAX_PIECE_SHORTLIST = 8
const SEARCH_LIMIT = 12
const PIECE_NAME_PREFIX = '@activepieces/piece-'

const EMPTY_SIGNALS: DiscoverySignals = { matchedNameTokens: 0, nameTokenCount: 0, descriptionHits: 0, cosine: null, catalogRank: null, semanticRank: null }

const STOP_WORDS: ReadonlySet<string> = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'each', 'every',
    'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'is', 'are', 'be', 'it', 'its',
    'my', 'me', 'our', 'us', 'their', 'when', 'then', 'new', 'all', 'any', 'via', 'per',
    'day', 'week', 'month', 'hour', 'minute', 'daily', 'weekly', 'morning',
])

export const toolCandidateSearch = {
    async discover({ intent, context, log }: DiscoverParams): Promise<ToolCandidate[]> {
        const tokens = tokenize(intentText({ intent }))
        const [catalogNames, semanticNames] = await Promise.all([
            catalogSearch({ intent, context, log }),
            semanticSearch({ intent, context, log }),
        ])

        const scores = new Map<string, DiscoverySignals>()
        const record = ({ pieceName, patch }: { pieceName: string, patch: Partial<DiscoverySignals> }): void => {
            const existing = scores.get(pieceName) ?? EMPTY_SIGNALS
            scores.set(pieceName, { ...existing, ...patch })
        }

        for (const piece of context.catalog) {
            const lexical = lexicalMatch({ piece, tokens })
            if (lexical.matchedNameTokens > 0 || lexical.descriptionHits > 0) {
                record({ pieceName: piece.name, patch: lexical })
            }
        }
        catalogNames.forEach((pieceName, index) => record({ pieceName, patch: { catalogRank: index } }))
        semanticNames.forEach(({ pieceName, cosine }, index) => record({ pieceName, patch: { semanticRank: index, cosine } }))

        const named = namedProductPiece({ intent, context })
        if (!isNil(named) && !scores.has(named)) {
            record({ pieceName: named, patch: EMPTY_SIGNALS })
        }

        const ranked = [...scores.entries()]
            .filter(([pieceName]) => context.enabledPieceNames.has(pieceName))
            .sort(([leftName, left], [rightName, right]) =>
                discoveryRank({ signals: right, pieceName: rightName, context }) - discoveryRank({ signals: left, pieceName: leftName, context }))

        const shortlist = (isNil(named)
            ? ranked
            : [...ranked.filter(([pieceName]) => pieceName === named), ...ranked.filter(([pieceName]) => pieceName !== named)])
            .slice(0, MAX_PIECE_SHORTLIST)

        const expanded = await Promise.all(shortlist.map(([pieceName, signals]) => expandPiece({ pieceName, signals, intent, context })))
        return expanded.flat()
    },
}

function intentText({ intent }: { intent: ToolIntent }): string {
    return [intent.summary, intent.service, intent.product].filter((part) => !isNil(part)).join(' ')
}

function namedProductPiece({ intent, context }: { intent: ToolIntent, context: ResolutionContext }): string | null {
    return pieceNamedBy({ text: intent.product, context }) ?? pieceNamedBy({ text: intent.service, context })
}

function pieceNamedBy({ text, context }: { text: string | null | undefined, context: ResolutionContext }): string | null {
    const wanted = tokenize(text ?? '')
    if (wanted.length === 0) {
        return null
    }
    const match = context.catalog.find((piece) => {
        if (!context.enabledPieceNames.has(piece.name)) {
            return false
        }
        const names = new Set(tokenize(`${piece.displayName} ${shortPieceName(piece.name).replace(/-/g, ' ')}`))
        return wanted.every((token) => names.has(token))
    })
    return match?.name ?? null
}

export function tokenizeIntent(text: string): string[] {
    return tokenize(text)
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
}

function shortPieceName(pieceName: string): string {
    return pieceName.startsWith(PIECE_NAME_PREFIX) ? pieceName.slice(PIECE_NAME_PREFIX.length) : pieceName
}

function lexicalMatch({ piece, tokens }: { piece: PieceMetadataModelSummary, tokens: string[] }): LexicalSignals {
    const nameTokens = new Set(tokenize(`${piece.displayName} ${shortPieceName(piece.name).replace(/-/g, ' ')}`))
    const descriptionTokens = new Set(tokenize(`${piece.description ?? ''} ${(piece.categories ?? []).join(' ')}`))
    return {
        matchedNameTokens: tokens.filter((token) => nameTokens.has(token)).length,
        nameTokenCount: nameTokens.size,
        descriptionHits: tokens.filter((token) => descriptionTokens.has(token)).length,
    }
}

function discoveryRank({ signals, pieceName, context }: { signals: DiscoverySignals, pieceName: string, context: ResolutionContext }): number {
    const named = nameScore({ signals, base: 100, span: 120 })
    const description = Math.min(signals.descriptionHits, 3) * 8
    const catalog = isNil(signals.catalogRank) ? 0 : Math.max(0, 30 - signals.catalogRank * 2)
    const semantic = isNil(signals.semanticRank) ? 0 : Math.max(0, 30 - signals.semanticRank * 2)
    const connected = context.connectedPieceNames.has(pieceName) ? 12 : 0
    return named + description + catalog + semantic + connected
}

export function describeObject({ object }: { object: Pick<ActionBase, 'description' | 'aiMetadata'> }): string {
    return object.aiMetadata?.description ?? object.description ?? ''
}

export function nameScore({ signals, base, span }: { signals: DiscoverySignals, base: number, span: number }): number {
    if (signals.matchedNameTokens === 0) {
        return 0
    }
    const coverage = signals.nameTokenCount === 0 ? 1 : signals.matchedNameTokens / signals.nameTokenCount
    return base + Math.round(coverage * span)
}

async function catalogSearch({ intent, context, log }: DiscoverParams): Promise<string[]> {
    const found = await Promise.all(catalogQueriesFor({ intent }).map((searchQuery) => runCatalogQuery({ searchQuery, intent, context, log })))
    const seen = new Set<string>()
    return found.flat().filter((pieceName) => {
        if (seen.has(pieceName)) {
            return false
        }
        seen.add(pieceName)
        return true
    })
}

async function runCatalogQuery({ searchQuery, intent, context }: RunCatalogQueryParams): Promise<string[]> {
    const pieces = await context.searchCatalog({
        searchQuery,
        suggestionType: intent.kind === ResolvedToolKind.ACTION ? SuggestionType.ACTION : SuggestionType.TRIGGER,
    })
    return pieces.map((piece) => piece.name)
}

async function semanticSearch({ intent, context, log }: DiscoverParams): Promise<SemanticHit[]> {
    const options = {
        platformId: context.platformId,
        projectId: context.projectId,
        limit: SEARCH_LIMIT,
        enabledPieceNames: context.enabledPieceNames,
        connectedPieceNames: context.connectedPieceNames,
    }
    const { data, error } = await tryCatch(async () => {
        const query = intentText({ intent })
        const response = intent.kind === ResolvedToolKind.ACTION
            ? await toolSearchService(log).searchActions(query, options)
            : await toolSearchService(log).searchTriggers(query, options)
        return response.results.map((row) => ({ pieceName: row.pieceName, cosine: row.cosine ?? null }))
    })
    if (isNil(data)) {
        log.warn({ error, project: { id: context.projectId } }, '[toolResolver] Semantic search failed')
        return []
    }
    const seen = new Set<string>()
    return data.flatMap((row) => {
        if (seen.has(row.pieceName)) {
            return []
        }
        seen.add(row.pieceName)
        return [row]
    })
}

function catalogQueriesFor({ intent }: { intent: ToolIntent }): string[] {
    const compact = tokenize(intentText({ intent })).slice(0, 6).join(' ')
    const service = isNil(intent.service) ? '' : tokenize(intent.service).join(' ')
    return [compact, service].filter((query, index, queries) => query.length > 0 && queries.indexOf(query) === index)
}

async function expandPiece({ pieceName, signals, intent, context }: ExpandParams): Promise<ToolCandidate[]> {
    const piece = await context.getPiece({ name: pieceName })
    if (isNil(piece)) {
        return []
    }
    const objects: (ActionBase | TriggerBase)[] = intent.kind === ResolvedToolKind.ACTION
        ? Object.values(piece.actions)
        : Object.values(piece.triggers)
    return objects.map((object) => toCandidate({ piece, object, signals, context }))
}

function toCandidate({ piece, object, signals, context }: ToCandidateParams): ToolCandidate {
    const pieceRequiresAuth = !isNil(piece.auth)
    return {
        pieceName: piece.name,
        pieceVersion: piece.version,
        pieceDisplayName: piece.displayName,
        pieceDescription: piece.description ?? '',
        pieceCategories: piece.categories ?? [],
        objectName: object.name,
        objectDisplayName: object.displayName,
        objectDescription: describeObject({ object }),
        requiresConnection: pieceRequiresAuth && (object.requireAuth ?? true),
        connectionAvailable: context.connectedPieceNames.has(piece.name),
        classification: object.classification,
        audience: 'audience' in object ? object.audience : undefined,
        requiredProperties: Object.entries(object.props)
            .filter(([, property]) => property.required)
            .map(([key]) => key),
        signals,
    }
}

type SemanticHit = {
    pieceName: string
    cosine: number | null
}

type DiscoverParams = {
    intent: ToolIntent
    context: ResolutionContext
    log: FastifyBaseLogger
}

type RunCatalogQueryParams = DiscoverParams & {
    searchQuery: string
}

type ExpandParams = {
    pieceName: string
    signals: DiscoverySignals
    intent: ToolIntent
    context: ResolutionContext
}

type ToCandidateParams = {
    piece: PieceMetadataModel
    object: ActionBase | TriggerBase
    signals: DiscoverySignals
    context: ResolutionContext
}

export type ToolIntent = {
    kind: ResolvedToolKind
    summary: string
    service: string | null
    product?: string | null
}

type LexicalSignals = Pick<DiscoverySignals, 'matchedNameTokens' | 'nameTokenCount' | 'descriptionHits'>

export type DiscoverySignals = {
    matchedNameTokens: number
    nameTokenCount: number
    descriptionHits: number
    cosine: number | null
    catalogRank: number | null
    semanticRank: number | null
}

export type ToolCandidate = {
    pieceName: string
    pieceVersion: string
    pieceDisplayName: string
    pieceDescription: string
    pieceCategories: PieceCategory[]
    objectName: string
    objectDisplayName: string
    objectDescription: string
    requiresConnection: boolean
    connectionAvailable: boolean
    classification: string | undefined
    audience: string | undefined
    requiredProperties: string[]
    signals: DiscoverySignals
}
