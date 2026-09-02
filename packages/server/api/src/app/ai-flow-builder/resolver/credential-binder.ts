import { isNil } from '@activepieces/core-utils'
import { ConnectionBindingReason, ConnectionBindingStatus, ResolvedConnection } from '@activepieces/shared'
import { SafeConnection } from '../../app-connection/app-connection-service/app-connection-service'

const NOT_REQUIRED: ResolvedConnection = {
    status: ConnectionBindingStatus.NOT_REQUIRED,
    reason: ConnectionBindingReason.PIECE_NEEDS_NO_ACCOUNT,
    externalId: null,
    displayName: null,
    options: [],
}

export const credentialBinder = {
    bind({ requiresConnection, pieceName, pieceDisplayName, requestText, connections, connectionsUsedByProject }: BindParams): ResolvedConnection {
        if (!requiresConnection) {
            return NOT_REQUIRED
        }

        const candidates = connections.filter((connection) => connection.pieceName === pieceName)
        if (candidates.length === 0) {
            return unbound({ status: ConnectionBindingStatus.MISSING, reason: ConnectionBindingReason.NO_ACCOUNT_CONNECTED, candidates })
        }
        if (candidates.length === 1) {
            return bound({ connection: candidates[0], reason: ConnectionBindingReason.ONLY_ACCOUNT_CONNECTED })
        }

        const named = namedInRequest({ candidates, requestText, pieceDisplayName })
        if (!isNil(named)) {
            return bound({ connection: named, reason: ConnectionBindingReason.NAMED_IN_REQUEST })
        }

        const established = onlyOneAlreadyInUse({ candidates, connectionsUsedByProject })
        if (!isNil(established)) {
            return bound({ connection: established, reason: ConnectionBindingReason.ALREADY_USED_BY_THIS_PROJECT })
        }

        return unbound({ status: ConnectionBindingStatus.NEEDS_SELECTION, reason: ConnectionBindingReason.SEVERAL_ACCOUNTS_MATCH, candidates })
    },
}

function namedInRequest({ candidates, requestText, pieceDisplayName }: NamedParams): SafeConnection | null {
    const requestTokens = new Set(tokenize(requestText))
    if (requestTokens.size === 0) {
        return null
    }
    const pieceTokens = new Set(tokenize(pieceDisplayName))
    const matched = candidates.filter((candidate) => {
        const distinctive = tokenize(candidate.displayName).filter((token) => !pieceTokens.has(token))
        return distinctive.length > 0 && distinctive.some((token) => requestTokens.has(token))
    })
    return matched.length === 1 ? matched[0] : null
}

function onlyOneAlreadyInUse({ candidates, connectionsUsedByProject }: EstablishedParams): SafeConnection | null {
    const inUse = candidates.filter((candidate) => connectionsUsedByProject.has(candidate.externalId))
    return inUse.length === 1 ? inUse[0] : null
}

function bound({ connection, reason }: { connection: SafeConnection, reason: ConnectionBindingReason }): ResolvedConnection {
    return {
        status: ConnectionBindingStatus.BOUND,
        reason,
        externalId: connection.externalId,
        displayName: connection.displayName,
        options: [],
    }
}

function unbound({ status, reason, candidates }: { status: ConnectionBindingStatus, reason: ConnectionBindingReason, candidates: SafeConnection[] }): ResolvedConnection {
    return {
        status,
        reason,
        externalId: null,
        displayName: null,
        options: candidates.map((candidate) => ({ externalId: candidate.externalId, displayName: candidate.displayName })),
    }
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2)
}

type NamedParams = {
    candidates: SafeConnection[]
    requestText: string
    pieceDisplayName: string
}

type EstablishedParams = {
    candidates: SafeConnection[]
    connectionsUsedByProject: ReadonlySet<string>
}

type BindParams = {
    requiresConnection: boolean
    pieceName: string
    pieceDisplayName: string
    requestText: string
    connections: SafeConnection[]
    connectionsUsedByProject: ReadonlySet<string>
}
