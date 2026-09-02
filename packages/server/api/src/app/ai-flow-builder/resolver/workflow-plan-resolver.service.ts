import { isNil } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    ResolvedStep,
    ResolvedTool,
    ResolvedToolKind,
    ResolvedTrigger,
    ResolveWorkflowPlanResponse,
    ResolveWorkflowPlanStatus,
    ToolResolutionConfidence,
    ToolResolutionStatus,
    WorkflowPlan,
    WorkflowStep,
    WorkflowStepKind,
    WorkflowTrigger,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { candidateRanking, ScoredCandidate } from './candidate-ranking'
import { coreTools } from './core-tool-bindings'
import { buildResolutionContext, ResolutionContext } from './resolution-context'
import { toolAdjudicator } from './tool-adjudicator'
import { tokenizeIntent, ToolCandidate, toolCandidateSearch, ToolIntent } from './tool-candidate-search'

export const workflowPlanResolverService = (log: FastifyBaseLogger): WorkflowPlanResolverService => ({
    async resolve({ projectId, platformId, plan }: ResolveParams): Promise<ResolveWorkflowPlanResponse> {
        const context = await buildResolutionContext({ projectId, platformId, log })
        if (context.catalog.length === 0) {
            return { status: ResolveWorkflowPlanStatus.FAILED, plan: null, issues: ['No pieces are available for this project'] }
        }

        const [trigger, steps] = await Promise.all([
            resolveTrigger({ trigger: plan.trigger, context, log }),
            Promise.all(plan.steps.map((step) => resolveStep({ step, context, log }))),
        ])

        const unresolvedStepIds = steps.filter((step) => step.status === ToolResolutionStatus.UNRESOLVED).map((step) => step.id)
        const triggerUnresolved = trigger.status === ToolResolutionStatus.UNRESOLVED

        log.info({
            project: { id: projectId },
            plan: {
                resolvedCount: steps.filter((step) => step.status === ToolResolutionStatus.RESOLVED).length,
                fallbackCount: steps.filter((step) => step.status === ToolResolutionStatus.FALLBACK).length,
                unresolvedCount: unresolvedStepIds.length,
            },
        }, '[toolResolver] Plan resolved')

        return {
            status: unresolvedStepIds.length === 0 && !triggerUnresolved ? ResolveWorkflowPlanStatus.RESOLVED : ResolveWorkflowPlanStatus.PARTIAL,
            plan: {
                version: plan.version,
                name: plan.name,
                description: plan.description,
                trigger,
                steps,
                unresolvedStepIds,
            },
            issues: [],
        }
    },

    async resolveStepIntent({ summary, projectId, platformId }: ResolveStepIntentParams): Promise<ResolvedTool | null> {
        const context = await buildResolutionContext({ projectId, platformId, log })
        if (context.catalog.length === 0) {
            return null
        }
        const outcome = await resolveIntent({
            intent: { kind: ResolvedToolKind.ACTION, summary, service: null },
            stepKind: WorkflowStepKind.OUTPUT,
            context,
            log,
        })
        return outcome.tool
    },
})

async function resolveTrigger({ trigger, context, log }: ResolveTriggerParams): Promise<ResolvedTrigger> {
    const base = { kind: trigger.kind, summary: trigger.summary, schedule: trigger.schedule ?? null }
    const coreBinding = coreTools.triggerFor({ kind: trigger.kind })
    if (!isNil(coreBinding)) {
        const tool = await bindCoreTool({ ...coreBinding, kind: ResolvedToolKind.TRIGGER, requestText: trigger.summary, context })
        if (isNil(tool)) {
            return { ...base, status: ToolResolutionStatus.UNRESOLVED, confidence: ToolResolutionConfidence.LOW, tool: null, reason: `The ${coreBinding.pieceName} piece is not available in this project` }
        }
        return { ...base, status: ToolResolutionStatus.RESOLVED, confidence: ToolResolutionConfidence.EXACT, tool, reason: null }
    }

    const outcome = await resolveIntent({
        intent: { kind: ResolvedToolKind.TRIGGER, summary: trigger.summary, service: trigger.service ?? null },
        stepKind: null,
        context,
        log,
    })
    if (!isNil(outcome.tool)) {
        return { ...base, status: ToolResolutionStatus.RESOLVED, confidence: outcome.confidence, tool: outcome.tool, reason: null }
    }

    const webhook = await bindCoreTool({ ...coreTools.webhookFallback, kind: ResolvedToolKind.TRIGGER, requestText: trigger.summary, context })
    if (isNil(webhook)) {
        return { ...base, status: ToolResolutionStatus.UNRESOLVED, confidence: ToolResolutionConfidence.LOW, tool: null, reason: outcome.reason }
    }
    return { ...base, status: ToolResolutionStatus.FALLBACK, confidence: ToolResolutionConfidence.LOW, tool: webhook, reason: 'No app specific trigger matched, so this event will arrive over a webhook' }
}

async function resolveStep({ step, context, log }: ResolveStepParams): Promise<ResolvedStep> {
    const base = { id: step.id, kind: step.kind, summary: step.summary, service: step.service ?? null, dependsOn: step.dependsOn }
    if (needsNoTool({ step })) {
        return { ...base, status: ToolResolutionStatus.NO_TOOL_REQUIRED, confidence: ToolResolutionConfidence.EXACT, tool: null, reason: 'This step reshapes data the flow already holds, so it needs no app' }
    }

    const outcome = await resolveIntent({
        intent: { kind: ResolvedToolKind.ACTION, summary: step.summary, service: step.service ?? null },
        stepKind: step.kind,
        context,
        log,
    })
    if (!isNil(outcome.tool)) {
        return { ...base, status: ToolResolutionStatus.RESOLVED, confidence: outcome.confidence, tool: outcome.tool, reason: null }
    }

    if (!allowsHttpFallback({ step })) {
        return { ...base, status: ToolResolutionStatus.UNRESOLVED, confidence: ToolResolutionConfidence.LOW, tool: null, reason: outcome.reason }
    }
    const http = await bindCoreTool({ ...coreTools.httpFallback, kind: ResolvedToolKind.ACTION, requestText: step.summary, context })
    if (isNil(http)) {
        return { ...base, status: ToolResolutionStatus.UNRESOLVED, confidence: ToolResolutionConfidence.LOW, tool: null, reason: outcome.reason }
    }
    return { ...base, status: ToolResolutionStatus.FALLBACK, confidence: ToolResolutionConfidence.LOW, tool: http, reason: 'No app specific step matched, so this will call the service over HTTP' }
}

async function resolveIntent({ intent, stepKind, context, log }: ResolveIntentParams): Promise<IntentOutcome> {
    const candidates = await toolCandidateSearch.discover({ intent, context, log })
    if (candidates.length === 0) {
        return { tool: null, confidence: ToolResolutionConfidence.LOW, reason: 'Nothing in the piece catalog matched this part of the plan' }
    }

    const intentTokens = intentTokensOf({ intent })
    const ranked = candidateRanking.rank({ candidates, intentTokens, stepKind })
    const confidence = candidateRanking.confidenceOf({ ranked })
    log.debug({ step: { name: intent.summary }, candidates: ranked.slice(0, 3).map(describe) }, '[toolResolver] Ranked candidates')

    if (confidence === ToolResolutionConfidence.HIGH) {
        return { tool: await toResolvedTool({ candidate: ranked[0].candidate, kind: intent.kind, requestText: intent.summary, context }), confidence, reason: null }
    }

    if (!isNil(context.model)) {
        const chosen = await toolAdjudicator.choose({ model: context.model, intent, ranked, log })
        if (!isNil(chosen)) {
            return { tool: await toResolvedTool({ candidate: chosen.candidate, kind: intent.kind, requestText: intent.summary, context }), confidence: ToolResolutionConfidence.MEDIUM, reason: null }
        }
        if (ranked[0].candidate.signals.matchedNameTokens === 0) {
            return { tool: null, confidence: ToolResolutionConfidence.LOW, reason: 'Nothing in the catalog was judged to do this job' }
        }
    }

    if (confidence === ToolResolutionConfidence.MEDIUM) {
        return { tool: await toResolvedTool({ candidate: ranked[0].candidate, kind: intent.kind, requestText: intent.summary, context }), confidence, reason: null }
    }
    return { tool: null, confidence, reason: 'No step in the catalog does this job closely enough to pick one' }
}

function needsNoTool({ step }: { step: WorkflowStep }): boolean {
    const internalKind = step.kind === WorkflowStepKind.TRANSFORM || step.kind === WorkflowStepKind.CONDITION
    return internalKind && isNil(step.service)
}

function allowsHttpFallback({ step }: { step: WorkflowStep }): boolean {
    const externalKind = step.kind === WorkflowStepKind.FETCH || step.kind === WorkflowStepKind.OUTPUT
    return externalKind && !isNil(step.service)
}

async function bindCoreTool({ pieceName, objectName, kind, requestText, context }: BindCoreParams): Promise<ResolvedTool | null> {
    const piece = await context.getPiece({ name: pieceName })
    if (isNil(piece)) {
        return null
    }
    const object = kind === ResolvedToolKind.ACTION ? piece.actions[objectName] : piece.triggers[objectName]
    if (isNil(object)) {
        return null
    }
    const needsAccount = requiresConnection({ piece, requireAuth: object.requireAuth })
    const connection = await context.connections.bind({
        pieceName: piece.name,
        pieceDisplayName: piece.displayName,
        requiresConnection: needsAccount,
        requestText,
    })
    return {
        kind,
        pieceName: piece.name,
        pieceVersion: piece.version,
        pieceDisplayName: piece.displayName,
        objectName: object.name,
        objectDisplayName: object.displayName,
        requiresConnection: needsAccount,
        connection,
        requiredProperties: Object.entries(object.props).filter(([, property]) => property.required).map(([key]) => key),
    }
}

function requiresConnection({ piece, requireAuth }: { piece: PieceMetadataModel, requireAuth: boolean | undefined }): boolean {
    return !isNil(piece.auth) && (requireAuth ?? true)
}

async function toResolvedTool({ candidate, kind, requestText, context }: ToResolvedToolParams): Promise<ResolvedTool> {
    return {
        kind,
        pieceName: candidate.pieceName,
        pieceVersion: candidate.pieceVersion,
        pieceDisplayName: candidate.pieceDisplayName,
        objectName: candidate.objectName,
        objectDisplayName: candidate.objectDisplayName,
        requiresConnection: candidate.requiresConnection,
        connection: await context.connections.bind({
            pieceName: candidate.pieceName,
            pieceDisplayName: candidate.pieceDisplayName,
            requiresConnection: candidate.requiresConnection,
            requestText,
        }),
        requiredProperties: candidate.requiredProperties,
    }
}

function intentTokensOf({ intent }: { intent: ToolIntent }): string[] {
    return tokenizeIntent([intent.summary, intent.service ?? ''].join(' '))
}

function describe({ candidate, score, signals }: ScoredCandidate): string {
    return `${candidate.pieceName}:${candidate.objectName}=${score} [${signals.join(' ')}]`
}

type BindCoreParams = {
    pieceName: string
    objectName: string
    kind: ResolvedToolKind
    requestText: string
    context: ResolutionContext
}

type ToResolvedToolParams = {
    candidate: ToolCandidate
    kind: ResolvedToolKind
    requestText: string
    context: ResolutionContext
}

type IntentOutcome = {
    tool: ResolvedTool | null
    confidence: ToolResolutionConfidence
    reason: string | null
}

type ResolveIntentParams = {
    intent: ToolIntent
    stepKind: WorkflowStepKind | null
    context: ResolutionContext
    log: FastifyBaseLogger
}

type ResolveTriggerParams = {
    trigger: WorkflowTrigger
    context: ResolutionContext
    log: FastifyBaseLogger
}

type ResolveStepParams = {
    step: WorkflowStep
    context: ResolutionContext
    log: FastifyBaseLogger
}

type ResolveStepIntentParams = {
    summary: string
    projectId: string
    platformId: string
}

type ResolveParams = {
    projectId: string
    platformId: string
    plan: WorkflowPlan
}

type WorkflowPlanResolverService = {
    resolve(params: ResolveParams): Promise<ResolveWorkflowPlanResponse>
    resolveStepIntent(params: ResolveStepIntentParams): Promise<ResolvedTool | null>
}
