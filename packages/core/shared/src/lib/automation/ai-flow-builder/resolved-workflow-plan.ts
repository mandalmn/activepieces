import { ApId, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'
import { WORKFLOW_PLAN_VERSION, WorkflowPlan, WorkflowSchedule, WorkflowStepId, WorkflowStepKind, WorkflowTriggerKind } from './workflow-plan'

export const MAX_TOOL_SHORTLIST = 8

export enum ToolResolutionStatus {
    RESOLVED = 'RESOLVED',
    FALLBACK = 'FALLBACK',
    NO_TOOL_REQUIRED = 'NO_TOOL_REQUIRED',
    UNRESOLVED = 'UNRESOLVED',
}

export enum ToolResolutionConfidence {
    EXACT = 'EXACT',
    HIGH = 'HIGH',
    MEDIUM = 'MEDIUM',
    LOW = 'LOW',
}

export enum ResolvedToolKind {
    ACTION = 'ACTION',
    TRIGGER = 'TRIGGER',
}

export enum ConnectionBindingStatus {
    NOT_REQUIRED = 'NOT_REQUIRED',
    BOUND = 'BOUND',
    NEEDS_SELECTION = 'NEEDS_SELECTION',
    MISSING = 'MISSING',
}

export enum ConnectionBindingReason {
    PIECE_NEEDS_NO_ACCOUNT = 'PIECE_NEEDS_NO_ACCOUNT',
    ONLY_ACCOUNT_CONNECTED = 'ONLY_ACCOUNT_CONNECTED',
    NAMED_IN_REQUEST = 'NAMED_IN_REQUEST',
    ALREADY_USED_BY_THIS_PROJECT = 'ALREADY_USED_BY_THIS_PROJECT',
    SEVERAL_ACCOUNTS_MATCH = 'SEVERAL_ACCOUNTS_MATCH',
    NO_ACCOUNT_CONNECTED = 'NO_ACCOUNT_CONNECTED',
}

export enum ResolveWorkflowPlanStatus {
    RESOLVED = 'RESOLVED',
    PARTIAL = 'PARTIAL',
    FAILED = 'FAILED',
}

export const ConnectionChoice = z.object({
    externalId: z.string(),
    displayName: z.string(),
})

export const ResolvedConnection = z.object({
    status: z.enum(ConnectionBindingStatus),
    reason: z.enum(ConnectionBindingReason),
    externalId: Nullable(z.string()),
    displayName: Nullable(z.string()),
    options: z.array(ConnectionChoice),
})

export const ResolvedTool = z.object({
    kind: z.enum(ResolvedToolKind),
    pieceName: z.string(),
    pieceVersion: z.string(),
    pieceDisplayName: z.string(),
    objectName: z.string(),
    objectDisplayName: z.string(),
    requiresConnection: z.boolean(),
    connection: ResolvedConnection,
    requiredProperties: z.array(z.string()),
})

export const ResolvedTrigger = z.object({
    kind: z.enum(WorkflowTriggerKind),
    summary: z.string(),
    schedule: Nullable(WorkflowSchedule),
    status: z.enum(ToolResolutionStatus),
    confidence: z.enum(ToolResolutionConfidence),
    tool: Nullable(ResolvedTool),
    reason: Nullable(z.string()),
})

export const ResolvedStep = z.object({
    id: WorkflowStepId,
    kind: z.enum(WorkflowStepKind),
    summary: z.string(),
    service: Nullable(z.string()),
    dependsOn: z.array(WorkflowStepId),
    status: z.enum(ToolResolutionStatus),
    confidence: z.enum(ToolResolutionConfidence),
    tool: Nullable(ResolvedTool),
    reason: Nullable(z.string()),
})

export const ResolvedWorkflowPlan = z.object({
    version: z.literal(WORKFLOW_PLAN_VERSION),
    name: z.string(),
    description: z.string(),
    trigger: ResolvedTrigger,
    steps: z.array(ResolvedStep),
    unresolvedStepIds: z.array(WorkflowStepId),
})

export const ResolveWorkflowPlanRequest = z.object({
    projectId: ApId,
    plan: WorkflowPlan,
})

export const ResolveWorkflowPlanResponse = z.object({
    status: z.enum(ResolveWorkflowPlanStatus),
    plan: Nullable(ResolvedWorkflowPlan),
    issues: z.array(z.string()),
})

export type ConnectionChoice = z.infer<typeof ConnectionChoice>
export type ResolvedConnection = z.infer<typeof ResolvedConnection>
export type ResolvedTool = z.infer<typeof ResolvedTool>
export type ResolvedTrigger = z.infer<typeof ResolvedTrigger>
export type ResolvedStep = z.infer<typeof ResolvedStep>
export type ResolvedWorkflowPlan = z.infer<typeof ResolvedWorkflowPlan>
export type ResolveWorkflowPlanRequest = z.infer<typeof ResolveWorkflowPlanRequest>
export type ResolveWorkflowPlanResponse = z.infer<typeof ResolveWorkflowPlanResponse>
