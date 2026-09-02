import { isNil, tryCatch } from '@activepieces/core-utils'
import {
    BranchCondition,
    BranchExecutionType,
    BranchOperator,
    EditCondition,
    EditRejection,
    FlowActionType,
    FlowEdit,
    FlowEditOperation,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    FlowTriggerType,
    PopulatedFlow,
    RouterExecutionType,
    StepLocationRelativeToParent,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../flows/flow/flow.service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { stepInputBuilder } from '../flow-generation/step-input-builder'
import { connectionBinder } from '../resolver/connection-lookup'
import { workflowPlanResolverService } from '../resolver/workflow-plan-resolver.service'

const PROTECTED_PROPERTIES: ReadonlySet<string> = new Set(['auth'])
const CREDENTIAL_MARKER = /\{\{\s*connections\s*\[/
const SCHEDULE_TRIGGER = 'cron_expression'

export const editApplier = (log: FastifyBaseLogger): EditApplier => ({
    apply({ edit, flow, projectId, platformId, userId }: ApplyParams): Promise<ApplyResult> {
        const context = { edit, flow, projectId, platformId, userId, log }
        switch (edit.operation) {
            case FlowEditOperation.CHANGE_SCHEDULE:
                return changeSchedule(context)
            case FlowEditOperation.REMOVE_ACTION:
                return removeAction(context)
            case FlowEditOperation.UPDATE_ACTION_INPUT:
                return updateActionInput(context)
            case FlowEditOperation.CHANGE_CONNECTION:
                return changeConnection(context)
            case FlowEditOperation.ADD_ACTION:
                return addAction(context)
            case FlowEditOperation.ADD_CONDITION:
                return addCondition(context)
        }
    },
})

async function changeSchedule({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    const trigger = flow.version.trigger
    if (trigger.type !== FlowTriggerType.PIECE || trigger.settings.triggerName !== SCHEDULE_TRIGGER) {
        return rejected(EditRejection.INVALID_SCHEDULE)
    }
    if (isNil(edit.cronExpression) || edit.cronExpression.trim().split(/\s+/).length !== 5) {
        return rejected(EditRejection.INVALID_SCHEDULE)
    }
    return run({
        flow, projectId, platformId, userId, log,
        operation: {
            type: FlowOperationType.UPDATE_TRIGGER,
            request: {
                name: trigger.name,
                displayName: trigger.displayName,
                valid: false,
                type: FlowTriggerType.PIECE,
                settings: {
                    ...trigger.settings,
                    input: {
                        ...trigger.settings.input,
                        cronExpression: edit.cronExpression,
                        ...(isNil(edit.timezone) ? {} : { timezone: edit.timezone }),
                    },
                },
            },
        },
    })
}

async function removeAction({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    const step = stepOf({ flow, name: edit.stepName })
    if (isNil(step)) {
        return rejected(EditRejection.UNKNOWN_STEP)
    }
    const actions = flowStructureUtil.getAllSteps(flow.version.trigger).filter((candidate) => flowStructureUtil.isAction(candidate.type))
    if (actions.length <= 1) {
        return rejected(EditRejection.WOULD_EMPTY_THE_FLOW)
    }
    return run({
        flow, projectId, platformId, userId, log,
        operation: { type: FlowOperationType.DELETE_ACTION, request: { names: [step.name] } },
    })
}

async function updateActionInput({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    const step = stepOf({ flow, name: edit.stepName })
    if (isNil(step) || step.type !== FlowActionType.PIECE) {
        return rejected(isNil(step) ? EditRejection.UNKNOWN_STEP : EditRejection.NOT_A_PIECE_STEP)
    }
    if (isNil(edit.propertyName)) {
        return rejected(EditRejection.UNKNOWN_PROPERTY)
    }
    if (PROTECTED_PROPERTIES.has(edit.propertyName)) {
        return rejected(EditRejection.PROTECTED_PROPERTY)
    }
    if (carriesCredential({ value: edit.value })) {
        return rejected(EditRejection.CREDENTIAL_IN_VALUE)
    }
    const piece = await loadPiece({ name: String(step.settings.pieceName), projectId, platformId, log })
    const action = piece?.actions[String(step.settings.actionName)]
    if (isNil(action) || isNil(action.props[edit.propertyName])) {
        return rejected(EditRejection.UNKNOWN_PROPERTY)
    }
    return run({
        flow, projectId, platformId, userId, log,
        operation: pieceActionUpdate({ step, settings: { input: { ...step.settings.input, [edit.propertyName]: edit.value } } }),
    })
}

async function changeConnection({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    const step = stepOf({ flow, name: edit.stepName })
    if (isNil(step) || step.type !== FlowActionType.PIECE) {
        return rejected(isNil(step) ? EditRejection.UNKNOWN_STEP : EditRejection.NOT_A_PIECE_STEP)
    }
    const pieceName = String(step.settings.pieceName)
    const binder = connectionBinder({ projectId, platformId, log })
    const connections = await binder.connectionsFor({ pieceName })
    const wanted = (edit.connectionName ?? '').toLowerCase().trim()
    const matched = connections.filter((connection) => connection.displayName.toLowerCase().includes(wanted))
    if (wanted.length === 0 || matched.length === 0) {
        return rejected(EditRejection.NO_SUCH_CONNECTION)
    }
    if (matched.length > 1) {
        return rejected(EditRejection.AMBIGUOUS_CONNECTION)
    }
    return run({
        flow, projectId, platformId, userId, log,
        operation: pieceActionUpdate({ step, settings: { input: { ...step.settings.input, auth: `{{connections['${matched[0].externalId}']}}` } } }),
    })
}

async function addAction({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    if (isNil(edit.describedAction)) {
        return rejected(EditRejection.NO_MATCHING_TOOL)
    }
    const resolution = await workflowPlanResolverService(log).resolveStepIntent({
        summary: edit.describedAction,
        projectId,
        platformId,
    })
    if (isNil(resolution)) {
        return rejected(EditRejection.NO_MATCHING_TOOL)
    }
    const piece = await loadPiece({ name: resolution.pieceName, projectId, platformId, log })
    const action = piece?.actions[resolution.objectName]
    if (isNil(piece) || isNil(action)) {
        return rejected(EditRejection.NO_MATCHING_TOOL)
    }

    const parent = parentFor({ flow, afterStepName: edit.afterStepName })
    const built = stepInputBuilder.build({ object: action, connection: resolution.connection, upstreamStepName: null })
    return run({
        flow, projectId, platformId, userId, log,
        operation: {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: parent.name,
                stepLocationRelativeToParent: parent.location,
                ...(isNil(parent.branchIndex) ? {} : { branchIndex: parent.branchIndex }),
                action: {
                    type: FlowActionType.PIECE,
                    name: flowStructureUtil.findUnusedName(flow.version.trigger),
                    displayName: action.displayName,
                    valid: false,
                    settings: {
                        pieceName: piece.name,
                        pieceVersion: `~${piece.version}`,
                        actionName: action.name,
                        input: built.input,
                        propertySettings: {},
                        errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
                    },
                },
            },
        },
    })
}

async function addCondition({ edit, flow, projectId, platformId, userId, log }: Context): Promise<ApplyResult> {
    const condition = edit.condition
    if (isNil(condition)) {
        return rejected(EditRejection.UNKNOWN_STEP)
    }
    const source = stepOf({ flow, name: condition.sourceStepName })
    const guarded = stepOf({ flow, name: edit.stepName })
    if (isNil(source) || isNil(guarded)) {
        return rejected(EditRejection.UNKNOWN_STEP)
    }

    const routerName = flowStructureUtil.findUnusedName(flow.version.trigger)
    const withRouter = await run({
        flow, projectId, platformId, userId, log,
        operation: {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: source.name,
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                action: {
                    type: FlowActionType.ROUTER,
                    name: routerName,
                    displayName: 'Check',
                    valid: false,
                    settings: {
                        branches: [
                            { branchType: BranchExecutionType.CONDITION, branchName: edit.reason.slice(0, 40) || 'Condition', conditions: [[conditionOf({ condition })]] },
                            { branchType: BranchExecutionType.FALLBACK, branchName: 'Otherwise' },
                        ],
                        executionType: RouterExecutionType.EXECUTE_FIRST_MATCH,
                    },
                },
            },
        },
    })
    if (isNil(withRouter.flow)) {
        return withRouter
    }

    return run({
        flow: withRouter.flow, projectId, platformId, userId, log,
        operation: {
            type: FlowOperationType.MOVE_ACTION,
            request: {
                name: guarded.name,
                newParentStep: routerName,
                stepLocationRelativeToNewParent: StepLocationRelativeToParent.INSIDE_BRANCH,
                branchIndex: 0,
            },
        },
    })
}

function conditionOf({ condition }: { condition: EditCondition }): BranchCondition {
    const firstValue = `{{${condition.sourceStepName}['output']${condition.fieldPath === '' ? '' : `.${condition.fieldPath}`}}}`
    const operator = condition.operator
    if (operator === BranchOperator.NUMBER_IS_GREATER_THAN || operator === BranchOperator.NUMBER_IS_LESS_THAN || operator === BranchOperator.NUMBER_IS_EQUAL_TO) {
        return { firstValue, secondValue: condition.value, operator }
    }
    return { firstValue, secondValue: condition.value, operator }
}

function parentFor({ flow, afterStepName }: { flow: PopulatedFlow, afterStepName: string | null | undefined }): ParentTarget {
    const named = stepOf({ flow, name: afterStepName })
    if (!isNil(named) && named.type === FlowActionType.ROUTER) {
        return { name: named.name, location: StepLocationRelativeToParent.INSIDE_BRANCH, branchIndex: 0 }
    }
    if (!isNil(named)) {
        return { name: named.name, location: StepLocationRelativeToParent.AFTER, branchIndex: null }
    }
    const steps = flowStructureUtil.getAllSteps(flow.version.trigger)
    return { name: steps[steps.length - 1].name, location: StepLocationRelativeToParent.AFTER, branchIndex: null }
}

function pieceActionUpdate({ step, settings }: { step: Step, settings: { input: Record<string, unknown> } }): FlowOperationRequest {
    return {
        type: FlowOperationType.UPDATE_ACTION as const,
        request: {
            type: FlowActionType.PIECE,
            name: step.name,
            displayName: step.displayName,
            valid: false,
            skip: false,
            settings: { ...step.settings, ...settings },
        },
    }
}

async function run({ flow, projectId, platformId, userId, operation, log }: RunParams): Promise<ApplyResult> {
    const { data, error } = await tryCatch(() => flowService(log).update({
        id: flow.id,
        projectId,
        platformId,
        userId,
        previousFlow: flow,
        operation,
    }))
    if (isNil(data)) {
        log.warn({ error, flow: { id: flow.id } }, '[flowEdit] Could not apply the edit')
        return rejected(EditRejection.APPLY_FAILED)
    }
    return { flow: data, rejection: null }
}

function stepOf({ flow, name }: { flow: PopulatedFlow, name: string | null | undefined }) {
    if (isNil(name)) {
        return undefined
    }
    return flowStructureUtil.getAllSteps(flow.version.trigger).find((step) => step.name === name)
}

async function loadPiece({ name, projectId, platformId, log }: { name: string, projectId: string, platformId: string, log: FastifyBaseLogger }) {
    const { data } = await tryCatch(() => pieceMetadataService(log).get({ name, projectId, platformId }))
    return data ?? null
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

function rejected(rejection: EditRejection): ApplyResult {
    return { flow: null, rejection }
}

type Step = ReturnType<typeof flowStructureUtil.getAllSteps>[number]

type ParentTarget = {
    name: string
    location: StepLocationRelativeToParent
    branchIndex: number | null
}

type RunParams = {
    flow: PopulatedFlow
    projectId: string
    platformId: string
    userId: string | undefined
    operation: FlowOperationRequest
    log: FastifyBaseLogger
}

type Context = {
    edit: FlowEdit
    flow: PopulatedFlow
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type ApplyParams = {
    edit: FlowEdit
    flow: PopulatedFlow
    projectId: string
    platformId: string
    userId: string | undefined
}

export type ApplyResult = {
    flow: PopulatedFlow | null
    rejection: EditRejection | null
}

type EditApplier = {
    apply(params: ApplyParams): Promise<ApplyResult>
}
