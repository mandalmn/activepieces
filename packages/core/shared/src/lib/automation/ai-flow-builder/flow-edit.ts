import { BranchOperator } from '@activepieces/core-execution'
import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { PublishGeneratedFlowResponse } from './flow-publish'
import { ValidateGeneratedFlowResponse } from './flow-validation'

export const MAX_EDIT_INSTRUCTION_LENGTH = 500
export const MAX_EDITS_PER_TURN = 4

export enum FlowEditOperation {
    CHANGE_SCHEDULE = 'CHANGE_SCHEDULE',
    ADD_ACTION = 'ADD_ACTION',
    REMOVE_ACTION = 'REMOVE_ACTION',
    UPDATE_ACTION_INPUT = 'UPDATE_ACTION_INPUT',
    CHANGE_CONNECTION = 'CHANGE_CONNECTION',
    ADD_CONDITION = 'ADD_CONDITION',
}

export enum FlowEditOutcome {
    APPLIED = 'APPLIED',
    NOT_UNDERSTOOD = 'NOT_UNDERSTOOD',
    NOTHING_APPLIED = 'NOTHING_APPLIED',
    UNAVAILABLE = 'UNAVAILABLE',
}

export enum EditRejection {
    UNKNOWN_STEP = 'UNKNOWN_STEP',
    UNKNOWN_PROPERTY = 'UNKNOWN_PROPERTY',
    PROTECTED_PROPERTY = 'PROTECTED_PROPERTY',
    CREDENTIAL_IN_VALUE = 'CREDENTIAL_IN_VALUE',
    NO_MATCHING_TOOL = 'NO_MATCHING_TOOL',
    NO_SUCH_CONNECTION = 'NO_SUCH_CONNECTION',
    AMBIGUOUS_CONNECTION = 'AMBIGUOUS_CONNECTION',
    INVALID_SCHEDULE = 'INVALID_SCHEDULE',
    WOULD_EMPTY_THE_FLOW = 'WOULD_EMPTY_THE_FLOW',
    NOT_A_PIECE_STEP = 'NOT_A_PIECE_STEP',
    APPLY_FAILED = 'APPLY_FAILED',
}

export const EDITABLE_NUMBER_OPERATORS = [
    BranchOperator.NUMBER_IS_GREATER_THAN,
    BranchOperator.NUMBER_IS_LESS_THAN,
    BranchOperator.NUMBER_IS_EQUAL_TO,
] as const

export const EDITABLE_TEXT_OPERATORS = [
    BranchOperator.TEXT_CONTAINS,
    BranchOperator.TEXT_EXACTLY_MATCHES,
] as const

export const EditCondition = z.object({
    sourceStepName: z.string(),
    fieldPath: z.string(),
    operator: z.enum([...EDITABLE_NUMBER_OPERATORS, ...EDITABLE_TEXT_OPERATORS]),
    value: z.string(),
})

export const FlowEdit = z.object({
    operation: z.enum(FlowEditOperation),
    stepName: Nullable(z.string()),
    afterStepName: Nullable(z.string()),
    describedAction: Nullable(z.string()),
    propertyName: Nullable(z.string()),
    value: Nullable(z.unknown()),
    cronExpression: Nullable(z.string()),
    timezone: Nullable(z.string()),
    connectionName: Nullable(z.string()),
    condition: Nullable(EditCondition),
    reason: z.string(),
})

export const RejectedEdit = z.object({
    edit: FlowEdit,
    rejection: z.enum(EditRejection),
})

export const EditFlowRequest = z.object({
    projectId: ApId,
    flowId: ApId,
    instruction: z.string().trim().min(1).max(MAX_EDIT_INSTRUCTION_LENGTH),
})

export const EditFlowResponse = z.object({
    outcome: z.enum(FlowEditOutcome),
    explanation: z.string(),
    applied: z.array(FlowEdit),
    rejected: z.array(RejectedEdit),
    validation: ValidateGeneratedFlowResponse,
    publication: Nullable(PublishGeneratedFlowResponse),
})

export type EditCondition = z.infer<typeof EditCondition>
export type FlowEdit = z.infer<typeof FlowEdit>
export type RejectedEdit = z.infer<typeof RejectedEdit>
export type EditFlowRequest = z.infer<typeof EditFlowRequest>
export type EditFlowResponse = z.infer<typeof EditFlowResponse>
