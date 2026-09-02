import { isNil, omit } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import { FlowActionType, PatchRejection, RepairOperation, RepairPatch, Step } from '@activepieces/shared'

const PROTECTED_PROPERTIES: ReadonlySet<string> = new Set(['auth'])
const CREDENTIAL_MARKER = /\{\{\s*connections\s*\[/
const DESTRUCTIVE = 'DESTRUCTIVE'

export const repairPatch = {
    screen({ patches, steps, pieces }: ScreenParams): ScreenedPatches {
        const applied: RepairPatch[] = []
        const rejected: { patch: RepairPatch, rejection: PatchRejection }[] = []

        for (const patch of patches) {
            const rejection = rejectionFor({ patch, steps, pieces })
            if (isNil(rejection)) {
                applied.push(patch)
                continue
            }
            rejected.push({ patch, rejection })
        }
        return { applied, rejected }
    },
}

function rejectionFor({ patch, steps, pieces }: { patch: RepairPatch, steps: Step[], pieces: Map<string, PieceMetadataModel | null> }): PatchRejection | null {
    const step = steps.find((candidate) => candidate.name === patch.stepName)
    if (isNil(step)) {
        return PatchRejection.UNKNOWN_STEP
    }
    if (step.type !== FlowActionType.PIECE) {
        return PatchRejection.NOT_A_PIECE_STEP
    }
    const piece = pieces.get(String(step.settings.pieceName ?? ''))
    if (isNil(piece)) {
        return PatchRejection.UNKNOWN_ACTION
    }
    const currentAction = piece.actions[String(step.settings.actionName ?? '')]

    if (patch.operation === RepairOperation.REPLACE_ACTION) {
        const target = isNil(patch.actionName) ? undefined : piece.actions[patch.actionName]
        if (isNil(target)) {
            return PatchRejection.UNKNOWN_ACTION
        }
        const becomesDestructive = target.classification === DESTRUCTIVE && currentAction?.classification !== DESTRUCTIVE
        return becomesDestructive ? PatchRejection.MORE_DESTRUCTIVE : null
    }

    if (isNil(patch.propertyName)) {
        return PatchRejection.UNKNOWN_PROPERTY
    }
    if (PROTECTED_PROPERTIES.has(patch.propertyName)) {
        return PatchRejection.PROTECTED_PROPERTY
    }
    if (isNil(currentAction) || isNil(currentAction.props[patch.propertyName])) {
        return PatchRejection.UNKNOWN_PROPERTY
    }
    if (patch.operation === RepairOperation.SET_PROPERTY && carriesCredential({ value: patch.value })) {
        return PatchRejection.CREDENTIAL_IN_VALUE
    }
    return null
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

export const applyPatches = ({ step, patches }: ApplyParams): PatchedStep => {
    const initialInput = 'input' in step.settings && typeof step.settings.input === 'object' && !isNil(step.settings.input)
        ? step.settings.input
        : {}

    return patches.reduce<PatchedStep>((current, patch) => {
        if (patch.operation === RepairOperation.REPLACE_ACTION && !isNil(patch.actionName)) {
            return { ...current, actionName: patch.actionName }
        }
        if (isNil(patch.propertyName)) {
            return current
        }
        if (patch.operation === RepairOperation.CLEAR_PROPERTY) {
            return { ...current, input: omit(current.input, [patch.propertyName]) }
        }
        return { ...current, input: { ...current.input, [patch.propertyName]: patch.value } }
    }, { actionName: String(step.settings.actionName ?? ''), input: { ...initialInput } })
}

type ScreenParams = {
    patches: RepairPatch[]
    steps: Step[]
    pieces: Map<string, PieceMetadataModel | null>
}

type ApplyParams = {
    step: Step
    patches: RepairPatch[]
}

export type PatchedStep = {
    actionName: string
    input: Record<string, unknown>
}

export type ScreenedPatches = {
    applied: RepairPatch[]
    rejected: { patch: RepairPatch, rejection: PatchRejection }[]
}
