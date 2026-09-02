import { isNil, tryCatch } from '@activepieces/core-utils'
import { ResolvedConnection } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { appConnectionService, SafeConnection } from '../../app-connection/app-connection-service/app-connection-service'
import { flowVersionRepo } from '../../flows/flow-version/flow-version.service'
import { credentialBinder } from './credential-binder'

const CONNECTIONS_PER_PIECE_LIMIT = 100
const FLOW_USAGE_LIMIT = 500

export const connectionBinder = ({ projectId, platformId, log }: ScopeParams): ConnectionBinderScope => {
    const byPieceName = new Map<string, Promise<SafeConnection[]>>()
    let usedByProject: Promise<ReadonlySet<string>> | null = null

    const connectionsFor = ({ pieceName }: { pieceName: string }): Promise<SafeConnection[]> => {
        const cached = byPieceName.get(pieceName)
        if (!isNil(cached)) {
            return cached
        }
        const pending = loadForPiece({ projectId, platformId, pieceName, log })
        byPieceName.set(pieceName, pending)
        return pending
    }

    return {
        connectionsFor,
        async bind({ pieceName, pieceDisplayName, requiresConnection, requestText }: BindParams): Promise<ResolvedConnection> {
            if (!requiresConnection) {
                return credentialBinder.bind({ requiresConnection, pieceName, pieceDisplayName, requestText, connections: [], connectionsUsedByProject: new Set() })
            }
            const connections = await connectionsFor({ pieceName })
            if (connections.length < 2) {
                return credentialBinder.bind({ requiresConnection, pieceName, pieceDisplayName, requestText, connections, connectionsUsedByProject: new Set() })
            }
            usedByProject = usedByProject ?? loadUsedByProject({ projectId, log })
            return credentialBinder.bind({
                requiresConnection,
                pieceName,
                pieceDisplayName,
                requestText,
                connections,
                connectionsUsedByProject: await usedByProject,
            })
        },
    }
}

async function loadForPiece({ projectId, platformId, pieceName, log }: LoadForPieceParams): Promise<SafeConnection[]> {
    const { data, error } = await tryCatch(() => appConnectionService(log).listSafeConnections({
        projectId,
        platformId,
        pieceNames: [pieceName],
        limit: CONNECTIONS_PER_PIECE_LIMIT,
    }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId }, piece: { name: pieceName } }, '[credentialBinder] Connection lookup failed, binding no account')
        return []
    }
    return data
}

async function loadUsedByProject({ projectId, log }: { projectId: string, log: FastifyBaseLogger }): Promise<ReadonlySet<string>> {
    const { data, error } = await tryCatch(() => flowVersionRepo().createQueryBuilder('flow_version')
        .select('flow_version.connectionIds', 'connectionIds')
        .innerJoin('flow_version.flow', 'flow')
        .where('flow.projectId = :projectId', { projectId })
        .andWhere('flow_version.connectionIds IS NOT NULL')
        .limit(FLOW_USAGE_LIMIT)
        .getRawMany<{ connectionIds: string[] | null }>())
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId } }, '[credentialBinder] Existing flow lookup failed, binding without an established preference')
        return new Set()
    }
    return new Set(data.flatMap((row) => row.connectionIds ?? []))
}

type ScopeParams = {
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type LoadForPieceParams = ScopeParams & {
    pieceName: string
}

type BindParams = {
    pieceName: string
    pieceDisplayName: string
    requiresConnection: boolean
    requestText: string
}

export type ConnectionBinderScope = {
    connectionsFor(params: { pieceName: string }): Promise<SafeConnection[]>
    bind(params: BindParams): Promise<ResolvedConnection>
}
