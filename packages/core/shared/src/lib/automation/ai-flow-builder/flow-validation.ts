import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export enum FlowValidationSeverity {
    ERROR = 'ERROR',
    WARNING = 'WARNING',
}

export enum FlowValidationRule {
    TRIGGER_NOT_CONFIGURED = 'TRIGGER_NOT_CONFIGURED',
    PIECE_NOT_FOUND = 'PIECE_NOT_FOUND',
    COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
    REQUIRED_PROPERTY_MISSING = 'REQUIRED_PROPERTY_MISSING',
    UNKNOWN_PROPERTY = 'UNKNOWN_PROPERTY',
    CONNECTION_MISSING = 'CONNECTION_MISSING',
    MALFORMED_EXPRESSION = 'MALFORMED_EXPRESSION',
    UNKNOWN_STEP_REFERENCE = 'UNKNOWN_STEP_REFERENCE',
    FORWARD_STEP_REFERENCE = 'FORWARD_STEP_REFERENCE',
    UNKNOWN_OUTPUT_FIELD = 'UNKNOWN_OUTPUT_FIELD',
    EMPTY_FLOW = 'EMPTY_FLOW',
    DUPLICATE_STEP_NAME = 'DUPLICATE_STEP_NAME',
}

export enum StepTestability {
    TESTABLE = 'TESTABLE',
    UNSAFE_TO_AUTO_TEST = 'UNSAFE_TO_AUTO_TEST',
    NOT_CONFIGURED = 'NOT_CONFIGURED',
    NOT_APPLICABLE = 'NOT_APPLICABLE',
}

export enum FlowReadiness {
    READY = 'READY',
    MISSING_CONNECTION = 'MISSING_CONNECTION',
    NEEDS_REPAIR = 'NEEDS_REPAIR',
}

export const FlowValidationIssue = z.object({
    rule: z.enum(FlowValidationRule),
    severity: z.enum(FlowValidationSeverity),
    stepName: Nullable(z.string()),
    propertyName: Nullable(z.string()),
    detail: z.string(),
})

export const ValidatedStep = z.object({
    stepName: z.string(),
    displayName: z.string(),
    pieceName: Nullable(z.string()),
    isTrigger: z.boolean(),
    valid: z.boolean(),
    testability: z.enum(StepTestability),
    issues: z.array(FlowValidationIssue),
})

export const ValidateGeneratedFlowRequest = z.object({
    projectId: ApId,
    flowId: ApId,
})

export const ValidateGeneratedFlowResponse = z.object({
    readiness: z.enum(FlowReadiness),
    publishable: z.boolean(),
    flowVersionId: z.string(),
    steps: z.array(ValidatedStep),
    issues: z.array(FlowValidationIssue),
})

export type FlowValidationIssue = z.infer<typeof FlowValidationIssue>
export type ValidatedStep = z.infer<typeof ValidatedStep>
export type ValidateGeneratedFlowRequest = z.infer<typeof ValidateGeneratedFlowRequest>
export type ValidateGeneratedFlowResponse = z.infer<typeof ValidateGeneratedFlowResponse>
