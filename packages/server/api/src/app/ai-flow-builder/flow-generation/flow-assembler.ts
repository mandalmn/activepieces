import { isNil, tryCatch, unique } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    ConnectionBindingStatus,
    FlowActionType,
    FlowOperationType,
    flowStructureUtil,
    FlowTriggerType,
    GeneratedStep,
    GeneratedStepRequirement,
    PopulatedFlow,
    ResolvedStep,
    ResolvedTool,
    ResolvedTrigger,
    ResolvedWorkflowPlan,
    StepLocationRelativeToParent,
    ToolResolutionStatus,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../flows/flow/flow.service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { stepInputBuilder } from './step-input-builder'

const MAX_FLOW_NAME_LENGTH = 60

export const flowAssembler = (log: FastifyBaseLogger): FlowAssembler => ({
    async assemble({ plan, projectId, platformId, userId }: AssembleParams): Promise<AssembledFlow> {
        const flow = await flowService(log).create({
            projectId,
            request: { projectId, displayName: flowNameOf({ plan }) },
            ownerId: userId,
        })

        const triggerOutcome = await applyTrigger({ flow, trigger: plan.trigger, projectId, platformId, userId, log })
        const ordered = orderSteps({ steps: plan.steps })

        const stepNameByPlanId = new Map<string, string>()
        const report: GeneratedStep[] = [triggerOutcome.report]
        let current = triggerOutcome.flow
        let parentStepName = current.version.trigger.name

        for (const step of ordered) {
            const upstreamStepName = upstreamNameFor({ step, stepNameByPlanId })
            const outcome = await addStep({
                flow: current,
                step,
                parentStepName,
                upstreamStepName,
                projectId,
                platformId,
                userId,
                log,
            })
            report.push(outcome.report)
            if (!isNil(outcome.flow) && !isNil(outcome.stepName)) {
                current = outcome.flow
                parentStepName = outcome.stepName
                stepNameByPlanId.set(step.id, outcome.stepName)
                continue
            }
            if (!isNil(upstreamStepName)) {
                stepNameByPlanId.set(step.id, upstreamStepName)
            }
        }

        return { flow: current, steps: report }
    },
})

async function applyTrigger({ flow, trigger, projectId, platformId, userId, log }: ApplyTriggerParams): Promise<TriggerOutcome> {
    const tool = trigger.tool
    if (isNil(tool)) {
        return { flow, report: unresolvedTriggerReport({ trigger, flow }) }
    }
    const piece = await loadPiece({ tool, projectId, platformId, log })
    const object = piece?.triggers[tool.objectName]
    if (isNil(piece) || isNil(object)) {
        log.warn({ project: { id: projectId }, piece: { name: tool.pieceName } }, '[flowAssembler] Trigger piece unavailable, leaving the empty trigger')
        return { flow, report: unresolvedTriggerReport({ trigger, flow }) }
    }

    const built = stepInputBuilder.build({
        object,
        connection: tool.connection,
        upstreamStepName: null,
        seededInput: scheduleInput({ trigger }),
    })

    const { data, error } = await tryCatch(() => flowService(log).update({
        id: flow.id,
        projectId,
        platformId,
        userId,
        previousFlow: flow,
        operation: {
            type: FlowOperationType.UPDATE_TRIGGER,
            request: {
                name: flow.version.trigger.name,
                displayName: tool.objectDisplayName,
                valid: false,
                type: FlowTriggerType.PIECE,
                settings: {
                    pieceName: piece.name,
                    pieceVersion: `~${piece.version}`,
                    triggerName: object.name,
                    input: built.input,
                    propertySettings: {},
                },
            },
        },
    }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId } }, '[flowAssembler] Could not configure the trigger, leaving the empty trigger')
        return { flow, report: unresolvedTriggerReport({ trigger, flow }) }
    }
    return {
        flow: data,
        report: {
            stepName: data.version.trigger.name,
            planStepId: null,
            displayName: tool.objectDisplayName,
            pieceName: piece.name,
            actionName: object.name,
            valid: data.version.trigger.valid,
            connectionDisplayName: tool.connection.status === ConnectionBindingStatus.BOUND ? tool.connection.displayName : null,
            requirements: built.requirements,
            missingProperties: built.missingProperties,
        },
    }
}

function unresolvedTriggerReport({ trigger, flow }: { trigger: ResolvedTrigger, flow: PopulatedFlow }): GeneratedStep {
    return {
        stepName: flow.version.trigger.name,
        planStepId: null,
        displayName: trigger.summary,
        pieceName: null,
        actionName: null,
        valid: false,
        connectionDisplayName: null,
        requirements: [GeneratedStepRequirement.NO_TOOL_RESOLVED],
        missingProperties: [],
    }
}

async function addStep({ flow, step, parentStepName, upstreamStepName, projectId, platformId, userId, log }: AddStepParams): Promise<StepOutcome> {
    const tool = step.tool
    if (step.status === ToolResolutionStatus.NO_TOOL_REQUIRED || isNil(tool)) {
        return { flow: null, stepName: null, report: skippedReport({ step }) }
    }
    const piece = await loadPiece({ tool, projectId, platformId, log })
    const object = piece?.actions[tool.objectName]
    if (isNil(piece) || isNil(object)) {
        log.warn({ project: { id: projectId }, piece: { name: tool.pieceName } }, '[flowAssembler] Action piece unavailable, skipping the step')
        return { flow: null, stepName: null, report: skippedReport({ step }) }
    }

    const stepName = flowStructureUtil.findUnusedName(flow.version.trigger)
    const built = stepInputBuilder.build({ object, connection: tool.connection, upstreamStepName })

    const { data, error } = await tryCatch(() => flowService(log).update({
        id: flow.id,
        projectId,
        platformId,
        userId,
        previousFlow: flow,
        operation: {
            type: FlowOperationType.ADD_ACTION,
            request: {
                parentStep: parentStepName,
                stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                action: {
                    type: FlowActionType.PIECE,
                    name: stepName,
                    displayName: tool.objectDisplayName,
                    valid: false,
                    settings: {
                        pieceName: piece.name,
                        pieceVersion: `~${piece.version}`,
                        actionName: object.name,
                        input: built.input,
                        propertySettings: {},
                        errorHandlingOptions: {
                            continueOnFailure: { value: false },
                            retryOnFailure: { value: false },
                        },
                    },
                },
            },
        },
    }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId }, step: { name: stepName } }, '[flowAssembler] Could not add the step')
        return { flow: null, stepName: null, report: skippedReport({ step }) }
    }

    const added = flowStructureUtil.getAllSteps(data.version.trigger).find((candidate) => candidate.name === stepName)
    return {
        flow: data,
        stepName,
        report: {
            stepName,
            planStepId: step.id,
            displayName: tool.objectDisplayName,
            pieceName: piece.name,
            actionName: object.name,
            valid: added?.valid ?? false,
            connectionDisplayName: tool.connection.status === ConnectionBindingStatus.BOUND ? tool.connection.displayName : null,
            requirements: built.requirements,
            missingProperties: built.missingProperties,
        },
    }
}

function skippedReport({ step }: { step: ResolvedStep }): GeneratedStep {
    const noTool = step.status === ToolResolutionStatus.NO_TOOL_REQUIRED
    return {
        stepName: step.id,
        planStepId: step.id,
        displayName: step.summary,
        pieceName: null,
        actionName: null,
        valid: noTool,
        connectionDisplayName: null,
        requirements: noTool ? [] : [GeneratedStepRequirement.NO_TOOL_RESOLVED],
        missingProperties: [],
    }
}

function orderSteps({ steps }: { steps: ResolvedStep[] }): ResolvedStep[] {
    const byId = new Map(steps.map((step) => [step.id, step]))
    const placed = new Set<string>()
    const ordered: ResolvedStep[] = []

    const place = (step: ResolvedStep, guard: Set<string>): void => {
        if (placed.has(step.id) || guard.has(step.id)) {
            return
        }
        guard.add(step.id)
        for (const dependency of step.dependsOn) {
            const upstream = byId.get(dependency)
            if (!isNil(upstream)) {
                place(upstream, guard)
            }
        }
        guard.delete(step.id)
        if (!placed.has(step.id)) {
            placed.add(step.id)
            ordered.push(step)
        }
    }

    for (const step of steps) {
        place(step, new Set())
    }
    return ordered
}

function upstreamNameFor({ step, stepNameByPlanId }: UpstreamParams): string | null {
    const named = unique(step.dependsOn.map((dependency) => stepNameByPlanId.get(dependency)).filter((name): name is string => !isNil(name)))
    return named.length === 1 ? named[0] : null
}

function scheduleInput({ trigger }: { trigger: ResolvedTrigger }): Record<string, unknown> {
    if (isNil(trigger.schedule)) {
        return {}
    }
    return {
        cronExpression: trigger.schedule.cronExpression,
        timezone: trigger.schedule.timezone,
    }
}

async function loadPiece({ tool, projectId, platformId, log }: LoadPieceParams): Promise<PieceMetadataModel | null> {
    const { data } = await tryCatch(() => pieceMetadataService(log).get({ name: tool.pieceName, projectId, platformId }))
    return data ?? null
}

function flowNameOf({ plan }: { plan: ResolvedWorkflowPlan }): string {
    const source = plan.name.trim()
    if (source.length === 0) {
        return 'Untitled'
    }
    return source.length <= MAX_FLOW_NAME_LENGTH ? source : `${source.slice(0, MAX_FLOW_NAME_LENGTH - 1).trimEnd()}…`
}

type LoadPieceParams = {
    tool: ResolvedTool
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type UpstreamParams = {
    step: ResolvedStep
    stepNameByPlanId: Map<string, string>
}

type StepOutcome = {
    flow: PopulatedFlow | null
    stepName: string | null
    report: GeneratedStep
}

type TriggerOutcome = {
    flow: PopulatedFlow
    report: GeneratedStep
}

type ApplyTriggerParams = {
    flow: PopulatedFlow
    trigger: ResolvedTrigger
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type AddStepParams = {
    flow: PopulatedFlow
    step: ResolvedStep
    parentStepName: string
    upstreamStepName: string | null
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type AssembleParams = {
    plan: ResolvedWorkflowPlan
    projectId: string
    platformId: string
    userId: string | undefined
}

export type AssembledFlow = {
    flow: PopulatedFlow
    steps: GeneratedStep[]
}

type FlowAssembler = {
    assemble(params: AssembleParams): Promise<AssembledFlow>
}
