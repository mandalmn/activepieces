import { isNil } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import { ActivationDecision, ActivationHold, ActivationHoldDetail, ActivationVerdict, FlowActionType, Step } from '@activepieces/shared'

const DESTRUCTIVE = 'DESTRUCTIVE'

export const activationPolicy = {
    decide({ steps, pieces }: DecideParams): ActivationVerdict {
        const holds = steps.flatMap((step) => holdsFor({ step, pieces }))
        return {
            decision: holds.length === 0 ? ActivationDecision.AUTOMATIC : ActivationDecision.NEEDS_APPROVAL,
            holds,
        }
    },
}

function holdsFor({ step, pieces }: { step: Step, pieces: Map<string, PieceMetadataModel | null> }): ActivationHoldDetail[] {
    if (step.type !== FlowActionType.PIECE) {
        return []
    }
    const piece = pieces.get(String(step.settings.pieceName ?? ''))
    const action = piece?.actions[String(step.settings.actionName ?? '')]
    if (isNil(piece) || isNil(action)) {
        return []
    }
    if (action.classification === DESTRUCTIVE) {
        return [{
            stepName: step.name,
            hold: ActivationHold.DESTRUCTIVE_ACTION,
            detail: `${piece.displayName}: ${action.displayName} can delete or overwrite data`,
        }]
    }
    if (isNil(action.classification)) {
        return [{
            stepName: step.name,
            hold: ActivationHold.UNDECLARED_RISK,
            detail: `${piece.displayName}: ${action.displayName} does not declare how risky it is`,
        }]
    }
    return []
}

type DecideParams = {
    steps: Step[]
    pieces: Map<string, PieceMetadataModel | null>
}
