export * from './flow-edit'
export * from './flow-publish'
export * from './flow-repair'
export * from './flow-validation'
export * from './resolved-workflow-plan'
export * from './workflow-plan'
import { ApId, formErrors, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { WorkflowPlan } from './workflow-plan'

export const AI_FLOW_PROMPT_MAX_LENGTH = 2_000

export enum AiFlowActionSkipReason {
    NO_AI_PROVIDER = 'NO_AI_PROVIDER',
    NO_TEXT_MODEL = 'NO_TEXT_MODEL',
    NO_MATCHING_ACTION = 'NO_MATCHING_ACTION',
    SUGGESTION_FAILED = 'SUGGESTION_FAILED',
}

export enum AiFlowGenerationStatus {
    DRAFTED = 'DRAFTED',
    NEEDS_MORE_DETAIL = 'NEEDS_MORE_DETAIL',
}

export enum GeneratedStepRequirement {
    CONNECTION_MISSING = 'CONNECTION_MISSING',
    CONNECTION_CHOICE = 'CONNECTION_CHOICE',
    REQUIRED_INPUT = 'REQUIRED_INPUT',
    INPUT_NEEDS_BUILDER = 'INPUT_NEEDS_BUILDER',
    NO_TOOL_RESOLVED = 'NO_TOOL_RESOLVED',
}

export const GeneratedStep = z.object({
    stepName: z.string(),
    planStepId: Nullable(z.string()),
    displayName: z.string(),
    pieceName: Nullable(z.string()),
    actionName: Nullable(z.string()),
    valid: z.boolean(),
    connectionDisplayName: Nullable(z.string()),
    requirements: z.array(z.enum(GeneratedStepRequirement)),
    missingProperties: z.array(z.string()),
})

export const AiFlowSchedule = z.object({
    cronExpression: z.string(),
    timezone: z.string(),
    description: z.string(),
})

export const AiFlowSuggestedAction = z.object({
    pieceName: z.string(),
    actionName: z.string(),
    displayName: z.string(),
})

export const GenerateFlowFromPromptRequest = z.object({
    projectId: ApId,
    prompt: z.string().trim().min(1, formErrors.required).max(AI_FLOW_PROMPT_MAX_LENGTH, formErrors.aiFlowPromptTooLong),
    plan: Nullable(WorkflowPlan),
})

export const GenerateFlowFromPromptResponse = z.object({
    status: z.enum(AiFlowGenerationStatus),
    prompt: z.string(),
    flowId: z.string().nullable(),
    schedule: AiFlowSchedule.nullable(),
    suggestedAction: AiFlowSuggestedAction.nullable(),
    actionSkipReason: z.enum(AiFlowActionSkipReason).nullable(),
    steps: z.array(GeneratedStep),
})

export type GeneratedStep = z.infer<typeof GeneratedStep>
export type AiFlowSchedule = z.infer<typeof AiFlowSchedule>
export type AiFlowSuggestedAction = z.infer<typeof AiFlowSuggestedAction>
export type GenerateFlowFromPromptRequest = z.infer<typeof GenerateFlowFromPromptRequest>
export type GenerateFlowFromPromptResponse = z.infer<typeof GenerateFlowFromPromptResponse>
