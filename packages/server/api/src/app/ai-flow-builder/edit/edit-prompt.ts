import { isNil, tryCatch } from '@activepieces/core-utils'
import { PieceMetadataModel, PropertyType } from '@activepieces/pieces-framework'
import {
    EDITABLE_NUMBER_OPERATORS,
    EDITABLE_TEXT_OPERATORS,
    FlowActionType,
    FlowEditOperation,
    flowStructureUtil,
    FlowTriggerType,
    PopulatedFlow,
    Step,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'

const REDACTED = '<a connected account>'
const CREDENTIAL_MARKER = /\{\{\s*connections\s*\[[^\]]*\]\s*\}\}/g

export const editPrompt = {
    async build({ flow, projectId, platformId, log }: BuildParams): Promise<string> {
        const steps = flowStructureUtil.getAllSteps(flow.version.trigger)
        const pieces = await loadPieces({ steps, projectId, platformId, log })

        return [
            'You turn one instruction into the smallest set of changes to an automation that already exists.',
            'You never rebuild the automation and you never touch anything the instruction did not ask about.',
            '',
            'The only changes you may make:',
            `- ${FlowEditOperation.CHANGE_SCHEDULE}: set cronExpression, and timezone when the person names one.`,
            `- ${FlowEditOperation.ADD_ACTION}: set describedAction to a plain sentence, and afterStepName to the step it follows.`,
            `- ${FlowEditOperation.REMOVE_ACTION}: set stepName.`,
            `- ${FlowEditOperation.UPDATE_ACTION_INPUT}: set stepName, propertyName and value.`,
            `- ${FlowEditOperation.CHANGE_CONNECTION}: set stepName and connectionName to words from the account name.`,
            `- ${FlowEditOperation.ADD_CONDITION}: set stepName to the step that should only run when the condition holds, and condition to { sourceStepName, fieldPath, operator, value }.`,
            '',
            'Rules:',
            '- Use only step names listed below. A name that is not listed will be thrown away.',
            '- Only use property names listed under that step.',
            '- Never write a connection or a credential into a value.',
            `- A condition operator is one of: ${[...EDITABLE_NUMBER_OPERATORS, ...EDITABLE_TEXT_OPERATORS].join(', ')}.`,
            '- fieldPath is the path inside the earlier step output, for example "price.change" or "" for the whole output.',
            '- Give each change a short reason written for the person who asked.',
            '- Answer with [] when the instruction does not describe a change to this automation.',
            '',
            'The automation right now:',
            ...describeTrigger({ flow }),
            ...steps.slice(1).flatMap((step) => describeStep({ step, pieces })),
            '',
            'Answer with a JSON array of changes and nothing else.',
        ].join('\n')
    },
}

function describeTrigger({ flow }: { flow: PopulatedFlow }): string[] {
    const trigger = flow.version.trigger
    if (trigger.type !== FlowTriggerType.PIECE) {
        return [`  ${trigger.name} — trigger (not configured)`]
    }
    return [`  ${trigger.name} — trigger ${trigger.settings.triggerName}, currently ${JSON.stringify(safeInput({ step: trigger }))}`]
}

function describeStep({ step, pieces }: { step: Step, pieces: Map<string, PieceMetadataModel | null> }): string[] {
    if (step.type === FlowActionType.ROUTER) {
        return [`  ${step.name} — a condition step`]
    }
    if (step.type !== FlowActionType.PIECE) {
        return [`  ${step.name} — ${step.displayName}`]
    }
    const piece = pieces.get(String(step.settings.pieceName ?? ''))
    const action = piece?.actions[String(step.settings.actionName ?? '')]
    if (isNil(piece) || isNil(action)) {
        return [`  ${step.name} — ${step.displayName}`]
    }
    const properties = Object.entries(action.props)
        .filter(([, property]) => property.type !== PropertyType.MARKDOWN)
        .map(([name]) => name)
        .join(', ')
    return [
        `  ${step.name} — ${piece.displayName}: ${action.displayName}`,
        `      properties: ${properties}`,
        `      currently: ${JSON.stringify(safeInput({ step }))}`,
    ]
}

async function loadPieces({ steps, projectId, platformId, log }: LoadPiecesParams): Promise<Map<string, PieceMetadataModel | null>> {
    const names = [...new Set(steps.flatMap((step) => {
        const name = step.settings.pieceName
        return typeof name === 'string' ? [name] : []
    }))]
    const loaded = await Promise.all(names.map(async (name) => {
        const { data } = await tryCatch(() => pieceMetadataService(log).get({ name, projectId, platformId }))
        return [name, data ?? null] as const
    }))
    return new Map(loaded)
}

function safeInput({ step }: { step: Step }): Record<string, unknown> {
    const input = 'input' in step.settings && typeof step.settings.input === 'object' && !isNil(step.settings.input)
        ? step.settings.input
        : {}
    return Object.fromEntries(Object.entries(input)
        .filter(([key]) => key !== 'auth')
        .map(([key, value]) => [key, redact({ value })]))
}

function redact({ value }: { value: unknown }): unknown {
    if (typeof value === 'string') {
        return value.replace(CREDENTIAL_MARKER, REDACTED)
    }
    if (Array.isArray(value)) {
        return value.map((entry) => redact({ value: entry }))
    }
    if (typeof value === 'object' && !isNil(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact({ value: entry })]))
    }
    return value
}

type LoadPiecesParams = {
    steps: Step[]
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type BuildParams = {
    flow: PopulatedFlow
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}
