import { FlowStatus } from '@activepieces/core-execution'
import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { ValidateGeneratedFlowResponse } from './flow-validation'

export enum AutomationLifecycle {
    DRAFT = 'DRAFT',
    NEEDS_SETUP = 'NEEDS_SETUP',
    READY = 'READY',
    ACTIVE = 'ACTIVE',
    FAILED = 'FAILED',
}

export enum ActivationDecision {
    AUTOMATIC = 'AUTOMATIC',
    NEEDS_APPROVAL = 'NEEDS_APPROVAL',
}

export enum ActivationHold {
    DESTRUCTIVE_ACTION = 'DESTRUCTIVE_ACTION',
    UNDECLARED_RISK = 'UNDECLARED_RISK',
}

export const ActivationHoldDetail = z.object({
    stepName: z.string(),
    hold: z.enum(ActivationHold),
    detail: z.string(),
})

export const ActivationVerdict = z.object({
    decision: z.enum(ActivationDecision),
    holds: z.array(ActivationHoldDetail),
})

export const PublishGeneratedFlowRequest = z.object({
    projectId: ApId,
    flowId: ApId,
    approveActivation: z.boolean().optional(),
})

export const PublishGeneratedFlowResponse = z.object({
    lifecycle: z.enum(AutomationLifecycle),
    activation: ActivationVerdict,
    flowId: z.string(),
    publishedVersionId: Nullable(z.string()),
    status: z.enum(FlowStatus),
    validation: ValidateGeneratedFlowResponse,
})

export type ActivationHoldDetail = z.infer<typeof ActivationHoldDetail>
export type ActivationVerdict = z.infer<typeof ActivationVerdict>
export type PublishGeneratedFlowRequest = z.infer<typeof PublishGeneratedFlowRequest>
export type PublishGeneratedFlowResponse = z.infer<typeof PublishGeneratedFlowResponse>
