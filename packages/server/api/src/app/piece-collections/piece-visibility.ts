import { isNil } from '@activepieces/core-utils'
import { PieceMetadataModel, PieceMetadataModelSummary } from '@activepieces/pieces-framework'
import { ApEdition, isComponentVisible, isPieceVisible, PieceSetConfig } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { system } from '../helper/system/system'
import { PieceMetadataSchema } from '../pieces/metadata/piece-metadata-entity'
import { pieceCollectionService } from './piece-collection.service'

export async function resolveCommunityVisibility({ platformId, projectId, log }: ResolveCommunityVisibilityParams): Promise<CommunityVisibilityPolicy | null> {
    if (system.getEdition() !== ApEdition.COMMUNITY) {
        return null
    }
    if (isNil(platformId) || isNil(projectId)) {
        return null
    }
    const config = await pieceCollectionService(log).resolveForProject({ platformId, projectId })
    if (isNil(config)) {
        return null
    }
    return buildPolicy(config)
}

function buildPolicy(config: PieceSetConfig): CommunityVisibilityPolicy {
    const isVisiblePiece = (name: string): boolean => isPieceVisible({ pieces: config.pieces, name })
    return {
        isPieceVisible: isVisiblePiece,
        filterPieces(pieces): PieceMetadataSchema[] {
            return pieces.filter((piece) => isVisiblePiece(piece.name))
        },
        filterComponents(summaries): PieceMetadataModelSummary[] {
            return summaries.map((summary) => ({
                ...summary,
                suggestedActions: summary.suggestedActions?.filter(
                    (action) => isComponentVisible({ selected: config.selectedActions[summary.name], name: action.name }),
                ),
                suggestedTriggers: summary.suggestedTriggers?.filter(
                    (trigger) => isComponentVisible({ selected: config.selectedTriggers[summary.name], name: trigger.name }),
                ),
            }))
        },
        filterPieceComponents(piece): PieceMetadataModel {
            return {
                ...piece,
                actions: Object.fromEntries(Object.entries(piece.actions).filter(([name]) => isComponentVisible({ selected: config.selectedActions[piece.name], name }))),
                triggers: Object.fromEntries(Object.entries(piece.triggers).filter(([name]) => isComponentVisible({ selected: config.selectedTriggers[piece.name], name }))),
            }
        },
    }
}

type ResolveCommunityVisibilityParams = {
    platformId: string | undefined
    projectId: string | undefined
    log: FastifyBaseLogger
}

export type CommunityVisibilityPolicy = {
    isPieceVisible(name: string): boolean
    filterPieces(pieces: PieceMetadataSchema[]): PieceMetadataSchema[]
    filterComponents(summaries: PieceMetadataModelSummary[]): PieceMetadataModelSummary[]
    filterPieceComponents(piece: PieceMetadataModel): PieceMetadataModel
}
