import { isNil, tryCatch } from '@activepieces/core-utils'
import {
    AiFlowActionSkipReason,
    AiFlowGenerationStatus,
    AiFlowSuggestedAction,
    ConnectionBindingStatus,
    FlowActionType,
    FlowOperationType,
    flowStructureUtil,
    FlowTriggerType,
    GenerateFlowFromPromptResponse,
    PopulatedFlow,
    ResolvedConnection,
    StepLocationRelativeToParent,
    WorkflowPlan,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../flows/flow/flow.service'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'
import { aiFlowActionSuggester } from './ai-flow-action-suggester'
import { flowAssembler } from './flow-generation/flow-assembler'
import { ParsedSchedule, promptScheduleParser } from './prompt-schedule-parser'
import { connectionBinder } from './resolver/connection-lookup'
import { workflowPlanResolverService } from './resolver/workflow-plan-resolver.service'
import { workflowPlanValidator } from './workflow-plan-validator'

const SCHEDULE_PIECE_NAME = '@activepieces/piece-schedule'
const CRON_TRIGGER_NAME = 'cron_expression'
const MAX_FLOW_NAME_LENGTH = 60

export const aiFlowBuilderService = (log: FastifyBaseLogger): AiFlowBuilderService => ({
    async generateFromPrompt({ projectId, platformId, userId, prompt, plan }: GenerateFromPromptParams): Promise<GenerateFlowFromPromptResponse> {
        const usablePlan = usablePlanOrNull({ plan, projectId, log })
        if (!isNil(usablePlan)) {
            return buildFromPlan({ plan: usablePlan, prompt, projectId, platformId, userId, log })
        }
        const schedule = scheduleFrom({ plan: usablePlan, prompt })
        if (isNil(schedule)) {
            log.info({ projectId }, '[aiFlowBuilder#generateFromPrompt] No schedule inferred from prompt')
            return {
                status: AiFlowGenerationStatus.NEEDS_MORE_DETAIL,
                prompt,
                flowId: null,
                schedule: null,
                suggestedAction: null,
                actionSkipReason: null,
                steps: [],
            }
        }

        const flow = await flowService(log).create({
            projectId,
            request: { projectId, displayName: flowName({ plan: usablePlan, prompt }) },
            ownerId: userId,
        })

        const scheduled = await applyScheduleTrigger({ flow, schedule, projectId, platformId, userId, log })
        const suggestion = await suggestActionSafely({ projectId, platformId, prompt, log })
        const suggestedAction = suggestion.action
        const withAction = isNil(suggestedAction)
            ? scheduled
            : await applySuggestedAction({ flow: scheduled, suggestedAction, prompt, projectId, platformId, userId, log })

        return {
            status: AiFlowGenerationStatus.DRAFTED,
            prompt,
            flowId: withAction.id,
            schedule,
            suggestedAction,
            actionSkipReason: suggestion.skipReason,
            steps: [],
        }
    },
})

async function buildFromPlan({ plan, prompt, projectId, platformId, userId, log }: BuildFromPlanParams): Promise<GenerateFlowFromPromptResponse> {
    const resolved = await workflowPlanResolverService(log).resolve({ projectId, platformId, plan })
    if (isNil(resolved.plan)) {
        log.info({ project: { id: projectId }, issues: resolved.issues }, '[aiFlowBuilder#buildFromPlan] Nothing to build from this plan')
        return {
            status: AiFlowGenerationStatus.NEEDS_MORE_DETAIL,
            prompt,
            flowId: null,
            schedule: null,
            suggestedAction: null,
            actionSkipReason: null,
            steps: [],
        }
    }

    const assembled = await flowAssembler(log).assemble({ plan: resolved.plan, prompt, projectId, platformId, userId })
    return {
        status: AiFlowGenerationStatus.DRAFTED,
        prompt,
        flowId: assembled.flow.id,
        schedule: plan.trigger.schedule ?? null,
        suggestedAction: null,
        actionSkipReason: null,
        steps: assembled.steps,
    }
}

async function applyScheduleTrigger({ flow, schedule, projectId, platformId, userId, log }: ApplyTriggerParams): Promise<PopulatedFlow> {
    const piece = await pieceMetadataService(log).get({ name: SCHEDULE_PIECE_NAME, projectId, platformId })
    if (isNil(piece)) {
        log.warn({ projectId }, '[aiFlowBuilder#applyScheduleTrigger] Schedule piece unavailable, leaving an empty trigger')
        return flow
    }
    return flowService(log).update({
        id: flow.id,
        projectId,
        platformId,
        userId,
        previousFlow: flow,
        operation: {
            type: FlowOperationType.UPDATE_TRIGGER,
            request: {
                name: flow.version.trigger.name,
                displayName: 'Schedule',
                valid: false,
                type: FlowTriggerType.PIECE,
                settings: {
                    pieceName: SCHEDULE_PIECE_NAME,
                    pieceVersion: `~${piece.version}`,
                    triggerName: CRON_TRIGGER_NAME,
                    input: {
                        cronExpression: schedule.cronExpression,
                        timezone: schedule.timezone,
                    },
                    propertySettings: {},
                },
            },
        },
    })
}

async function suggestActionSafely({ projectId, platformId, prompt, log }: SuggestSafelyParams): Promise<SuggestionResult> {
    const { data, error } = await tryCatch(() => aiFlowActionSuggester(log).suggest({ projectId, platformId, prompt }))
    if (!isNil(error) || isNil(data)) {
        log.warn({ error, projectId }, '[aiFlowBuilder#generateFromPrompt] Action suggestion failed, drafting the schedule only')
        return { action: null, skipReason: AiFlowActionSkipReason.SUGGESTION_FAILED }
    }
    return data
}

async function applySuggestedAction({ flow, suggestedAction, prompt, projectId, platformId, userId, log }: ApplyActionParams): Promise<PopulatedFlow> {
    const { data, error } = await tryCatch(async () => {
        const piece = await pieceMetadataService(log).get({ name: suggestedAction.pieceName, projectId, platformId })
        if (isNil(piece)) {
            return flow
        }
        const action = piece.actions[suggestedAction.actionName]
        const connection = await connectionBinder({ projectId, platformId, log }).bind({
            pieceName: piece.name,
            pieceDisplayName: piece.displayName,
            requiresConnection: !isNil(piece.auth) && (action?.requireAuth ?? true),
            requestText: prompt,
        })
        return flowService(log).update({
            id: flow.id,
            projectId,
            platformId,
            userId,
            previousFlow: flow,
            operation: {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: flow.version.trigger.name,
                    stepLocationRelativeToParent: StepLocationRelativeToParent.AFTER,
                    action: {
                        type: FlowActionType.PIECE,
                        name: flowStructureUtil.findUnusedName(flow.version.trigger),
                        displayName: suggestedAction.displayName,
                        valid: false,
                        settings: {
                            pieceName: suggestedAction.pieceName,
                            pieceVersion: `~${piece.version}`,
                            actionName: suggestedAction.actionName,
                            input: connectionInput({ connection }),
                            propertySettings: {},
                            errorHandlingOptions: {
                                continueOnFailure: { value: false },
                                retryOnFailure: { value: false },
                            },
                        },
                    },
                },
            },
        })
    })
    if (!isNil(error) || isNil(data)) {
        log.warn({ error, projectId }, '[aiFlowBuilder#applySuggestedAction] Could not add the suggested step, keeping the schedule')
        return flow
    }
    return data
}

function usablePlanOrNull({ plan, projectId, log }: UsablePlanParams): WorkflowPlan | null {
    if (isNil(plan)) {
        return null
    }
    const issues = workflowPlanValidator.validate({ plan })
    if (issues.length > 0) {
        log.warn({ projectId, issues }, '[aiFlowBuilder#generateFromPrompt] Discarding a plan that failed validation')
        return null
    }
    return plan
}

function scheduleFrom({ plan, prompt }: { plan: WorkflowPlan | null, prompt: string }): ParsedSchedule | null {
    const planned = plan?.trigger.schedule
    if (!isNil(planned)) {
        return planned
    }
    return promptScheduleParser.parse({ prompt })
}

function connectionInput({ connection }: { connection: ResolvedConnection }): Record<string, string> {
    if (connection.status !== ConnectionBindingStatus.BOUND || isNil(connection.externalId)) {
        return {}
    }
    return { auth: `{{connections['${connection.externalId}']}}` }
}

function flowName({ plan, prompt }: { plan: WorkflowPlan | null, prompt: string }): string {
    const source = plan?.name.trim() ?? prompt.trim().split('\n')[0].trim()
    if (source.length === 0) {
        return 'Untitled'
    }
    if (source.length <= MAX_FLOW_NAME_LENGTH) {
        return source
    }
    return `${source.slice(0, MAX_FLOW_NAME_LENGTH - 1).trimEnd()}…`
}

type GenerateFromPromptParams = {
    projectId: string
    platformId: string
    userId: string | undefined
    prompt: string
    plan: WorkflowPlan | null | undefined
}

type UsablePlanParams = {
    plan: WorkflowPlan | null | undefined
    projectId: string
    log: FastifyBaseLogger
}

type BuildFromPlanParams = {
    plan: WorkflowPlan
    prompt: string
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type ApplyTriggerParams = {
    flow: PopulatedFlow
    schedule: ParsedSchedule
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type SuggestSafelyParams = {
    projectId: string
    platformId: string
    prompt: string
    log: FastifyBaseLogger
}

type SuggestionResult = {
    action: AiFlowSuggestedAction | null
    skipReason: AiFlowActionSkipReason | null
}

type ApplyActionParams = {
    flow: PopulatedFlow
    suggestedAction: AiFlowSuggestedAction
    prompt: string
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type AiFlowBuilderService = {
    generateFromPrompt(params: GenerateFromPromptParams): Promise<GenerateFlowFromPromptResponse>
}
