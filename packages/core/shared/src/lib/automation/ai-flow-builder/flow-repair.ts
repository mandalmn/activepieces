import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { FlowValidationRule, ValidateGeneratedFlowResponse } from './flow-validation'
import { WorkflowPlan } from './workflow-plan'

export const MAX_REPAIR_ATTEMPTS = 3

export enum RepairOperation {
    SET_PROPERTY = 'SET_PROPERTY',
    CLEAR_PROPERTY = 'CLEAR_PROPERTY',
    REPLACE_ACTION = 'REPLACE_ACTION',
}

export enum RepairOutcome {
    REPAIRED = 'REPAIRED',
    IMPROVED = 'IMPROVED',
    UNCHANGED = 'UNCHANGED',
    NOT_ATTEMPTED = 'NOT_ATTEMPTED',
    UNAVAILABLE = 'UNAVAILABLE',
}

export enum PatchRejection {
    UNKNOWN_STEP = 'UNKNOWN_STEP',
    UNKNOWN_PROPERTY = 'UNKNOWN_PROPERTY',
    UNKNOWN_ACTION = 'UNKNOWN_ACTION',
    PROTECTED_PROPERTY = 'PROTECTED_PROPERTY',
    CREDENTIAL_IN_VALUE = 'CREDENTIAL_IN_VALUE',
    MORE_DESTRUCTIVE = 'MORE_DESTRUCTIVE',
    NOT_A_PIECE_STEP = 'NOT_A_PIECE_STEP',
}

export const RepairPatch = z.object({
    operation: z.enum(RepairOperation),
    stepName: z.string(),
    propertyName: Nullable(z.string()),
    value: Nullable(z.unknown()),
    actionName: Nullable(z.string()),
    reason: z.string(),
})

export const RejectedPatch = z.object({
    patch: RepairPatch,
    rejection: z.enum(PatchRejection),
})

export const RepairAttempt = z.object({
    attempt: z.number(),
    errorsBefore: z.number(),
    errorsAfter: z.number(),
    applied: z.array(RepairPatch),
    rejected: z.array(RejectedPatch),
    revertedForRegression: z.boolean(),
})

export const RepairGeneratedFlowRequest = z.object({
    projectId: ApId,
    flowId: ApId,
    prompt: z.string().max(2_000),
    plan: Nullable(WorkflowPlan),
})

export const RepairGeneratedFlowResponse = z.object({
    outcome: z.enum(RepairOutcome),
    attempts: z.array(RepairAttempt),
    validation: ValidateGeneratedFlowResponse,
    unrepairableRules: z.array(z.enum(FlowValidationRule)),
})

export type RepairPatch = z.infer<typeof RepairPatch>
export type RejectedPatch = z.infer<typeof RejectedPatch>
export type RepairAttempt = z.infer<typeof RepairAttempt>
export type RepairGeneratedFlowRequest = z.infer<typeof RepairGeneratedFlowRequest>
export type RepairGeneratedFlowResponse = z.infer<typeof RepairGeneratedFlowResponse>
