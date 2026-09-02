import { isNil, tryCatch } from '@activepieces/core-utils'
import { PieceMetadataModel, PieceMetadataModelSummary } from '@activepieces/pieces-framework'
import { SuggestionType } from '@activepieces/shared'
import { LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { appConnectionService } from '../../app-connection/app-connection-service/app-connection-service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { aiModelResolver } from '../ai-model-resolver'
import { connectionBinder, ConnectionBinderScope } from './connection-lookup'

const CONNECTED_PIECE_LIMIT = 200

export const buildResolutionContext = async ({ projectId, platformId, log }: BuildParams): Promise<ResolutionContext> => {
    const [catalog, connectedPieceNames, model] = await Promise.all([
        loadCatalog({ projectId, platformId, log }),
        loadConnectedPieceNames({ projectId, platformId, log }),
        loadTextModel({ projectId, platformId, log }),
    ])

    const pieceCache = new Map<string, Promise<PieceMetadataModel | null>>()
    const searchCache = new Map<string, Promise<PieceMetadataModelSummary[]>>()

    return {
        projectId,
        platformId,
        catalog,
        enabledPieceNames: new Set(catalog.map((piece) => piece.name)),
        connectedPieceNames,
        connections: connectionBinder({ projectId, platformId, log }),
        model,
        getPiece({ name }: { name: string }): Promise<PieceMetadataModel | null> {
            const cached = pieceCache.get(name)
            if (!isNil(cached)) {
                return cached
            }
            const pending = tryCatch(() => pieceMetadataService(log).get({ name, projectId, platformId }))
                .then(({ data }) => data ?? null)
            pieceCache.set(name, pending)
            return pending
        },
        searchCatalog({ searchQuery, suggestionType }: { searchQuery: string, suggestionType: SuggestionType }): Promise<PieceMetadataModelSummary[]> {
            const key = `${suggestionType}:${searchQuery}`
            const cached = searchCache.get(key)
            if (!isNil(cached)) {
                return cached
            }
            const pending = tryCatch(() => pieceMetadataService(log).list({
                projectId,
                platformId,
                includeHidden: false,
                searchQuery,
                suggestionType,
            })).then(({ data, error }) => {
                if (isNil(data)) {
                    log.warn({ error, project: { id: projectId } }, '[toolResolver] Catalog search failed')
                    return []
                }
                return data
            })
            searchCache.set(key, pending)
            return pending
        },
    }
}

async function loadCatalog({ projectId, platformId, log }: BuildParams): Promise<PieceMetadataModelSummary[]> {
    const { data, error } = await tryCatch(() => pieceMetadataService(log).list({ projectId, platformId, includeHidden: false }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId } }, '[toolResolver] Piece catalog unavailable, resolving without one')
        return []
    }
    return data
}

async function loadConnectedPieceNames({ projectId, platformId, log }: BuildParams): Promise<ReadonlySet<string>> {
    const { data, error } = await tryCatch(() => appConnectionService(log).listConnectedPieces({ projectId, platformId, limit: CONNECTED_PIECE_LIMIT }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId } }, '[toolResolver] Connection lookup failed, ranking without connection preference')
        return new Set()
    }
    return new Set(data.map((connection) => connection.pieceName))
}

async function loadTextModel({ projectId, platformId, log }: BuildParams): Promise<LanguageModel | null> {
    const { data } = await tryCatch(() => aiModelResolver(log).resolveTextModel({ projectId, platformId }))
    return data?.model ?? null
}

type BuildParams = {
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

export type ResolutionContext = {
    projectId: string
    platformId: string
    catalog: PieceMetadataModelSummary[]
    enabledPieceNames: ReadonlySet<string>
    connectedPieceNames: ReadonlySet<string>
    connections: ConnectionBinderScope
    model: LanguageModel | null
    getPiece(params: { name: string }): Promise<PieceMetadataModel | null>
    searchCatalog(params: { searchQuery: string, suggestionType: SuggestionType }): Promise<PieceMetadataModelSummary[]>
}
