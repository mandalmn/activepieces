import { ApId, formErrors, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export const WORKFLOW_PLAN_VERSION = 1
export const MAX_WORKFLOW_PLAN_STEPS = 12
export const MAX_WORKFLOW_PROMPT_LENGTH = 2_000
export const MAX_WORKFLOW_PLAN_NAME_LENGTH = 120
export const MAX_WORKFLOW_PLAN_TEXT_LENGTH = 400

export enum WorkflowTriggerKind {
    SCHEDULE = 'SCHEDULE',
    EVENT = 'EVENT',
    MANUAL = 'MANUAL',
}

export enum WorkflowStepKind {
    FETCH = 'FETCH',
    TRANSFORM = 'TRANSFORM',
    OUTPUT = 'OUTPUT',
    CONDITION = 'CONDITION',
}

export enum WorkflowPlanStatus {
    PLANNED = 'PLANNED',
    NEEDS_MORE_DETAIL = 'NEEDS_MORE_DETAIL',
    UNAVAILABLE = 'UNAVAILABLE',
    FAILED = 'FAILED',
}

export const WorkflowStepId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)

export const WorkflowSchedule = z.object({
    cronExpression: z.string().max(MAX_WORKFLOW_PLAN_NAME_LENGTH),
    timezone: z.string().max(MAX_WORKFLOW_PLAN_NAME_LENGTH),
    description: z.string().max(MAX_WORKFLOW_PLAN_TEXT_LENGTH),
})

export const WorkflowTrigger = z.object({
    kind: z.enum(WorkflowTriggerKind),
    summary: z.string().min(1).max(MAX_WORKFLOW_PLAN_TEXT_LENGTH),
    service: Nullable(z.string().max(MAX_WORKFLOW_PLAN_NAME_LENGTH)),
    schedule: Nullable(WorkflowSchedule),
})

export const WorkflowStep = z.object({
    id: WorkflowStepId,
    kind: z.enum(WorkflowStepKind),
    summary: z.string().min(1).max(MAX_WORKFLOW_PLAN_TEXT_LENGTH),
    service: Nullable(z.string().max(MAX_WORKFLOW_PLAN_NAME_LENGTH)),
    dependsOn: z.array(WorkflowStepId).max(MAX_WORKFLOW_PLAN_STEPS),
})

export const WorkflowPlan = z.object({
    version: z.literal(WORKFLOW_PLAN_VERSION),
    name: z.string().min(1).max(MAX_WORKFLOW_PLAN_NAME_LENGTH),
    description: z.string().max(MAX_WORKFLOW_PLAN_TEXT_LENGTH),
    trigger: WorkflowTrigger,
    steps: z.array(WorkflowStep).min(1).max(MAX_WORKFLOW_PLAN_STEPS),
})

export const PlanWorkflowRequest = z.object({
    projectId: ApId,
    prompt: z.string().trim().min(1, formErrors.required).max(MAX_WORKFLOW_PROMPT_LENGTH, formErrors.aiFlowPromptTooLong),
    timezone: z.string().optional(),
})

export const PlanWorkflowResponse = z.object({
    status: z.enum(WorkflowPlanStatus),
    prompt: z.string(),
    plan: Nullable(WorkflowPlan),
    issues: z.array(z.string()),
})

export type WorkflowSchedule = z.infer<typeof WorkflowSchedule>
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>
export type WorkflowStep = z.infer<typeof WorkflowStep>
export type WorkflowPlan = z.infer<typeof WorkflowPlan>
export type PlanWorkflowRequest = z.infer<typeof PlanWorkflowRequest>
export type PlanWorkflowResponse = z.infer<typeof PlanWorkflowResponse>
