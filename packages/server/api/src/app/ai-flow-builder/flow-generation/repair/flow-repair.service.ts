import { isNil, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    FlowActionType,
    FlowOperationType,
    flowStructureUtil,
    FlowValidationRule,
    FlowValidationSeverity,
    MAX_REPAIR_ATTEMPTS,
    PopulatedFlow,
    RepairAttempt,
    RepairGeneratedFlowResponse,
    RepairOutcome,
    RepairPatch,
    Step,
    ValidateGeneratedFlowResponse,
    WorkflowPlan,
} from '@activepieces/shared'
import { generateText, LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../../flows/flow/flow.service'
import { pieceMetadataService } from '../../../pieces/metadata/piece-metadata-service'
import { aiModelResolver } from '../../ai-model-resolver'
import { flowValidator } from '../flow-validator'
import { applyPatches, repairPatch } from './repair-patch'
import { repairPrompt } from './repair-prompt'

const UNREPAIRABLE_RULES: ReadonlySet<FlowValidationRule> = new Set([
    FlowValidationRule.CONNECTION_MISSING,
    FlowValidationRule.PIECE_NOT_FOUND,
    FlowValidationRule.TRIGGER_NOT_CONFIGURED,
    FlowValidationRule.EMPTY_FLOW,
    FlowValidationRule.DUPLICATE_STEP_NAME,
])

const REPAIR_TIMEOUT_MS = 30_000

export const flowRepairService = (log: FastifyBaseLogger): FlowRepairService => ({
    async repair({ flowId, projectId, platformId, userId, prompt, plan }: RepairParams): Promise<RepairGeneratedFlowResponse> {
        let flow = await flowService(log).getOnePopulatedOrThrow({ id: flowId, projectId })
        let validation = await validate({ flow, projectId, platformId, log })
        const attempts: RepairAttempt[] = []

        const unrepairableRules = [...new Set(errorsOf({ validation })
            .map((issue) => issue.rule)
            .filter((rule) => UNREPAIRABLE_RULES.has(rule)))]

        const model = await resolveModel({ projectId, platformId, log })
        if (isNil(model)) {
            return { outcome: RepairOutcome.UNAVAILABLE, attempts, validation, unrepairableRules }
        }

        for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
            const repairable = errorsOf({ validation }).filter((issue) => !UNREPAIRABLE_RULES.has(issue.rule))
            if (repairable.length === 0) {
                break
            }

            const outcome = await runAttempt({ attempt, flow, validation, model, prompt, plan, projectId, platformId, userId, log })
            if (isNil(outcome)) {
                break
            }
            attempts.push(outcome.attempt)
            flow = outcome.flow
            validation = outcome.validation
        }

        return {
            outcome: outcomeOf({ attempts, validation, unrepairableRules }),
            attempts,
            validation,
            unrepairableRules,
        }
    },
})

async function runAttempt({ attempt, flow, validation, model, prompt, plan, projectId, platformId, userId, log }: AttemptParams): Promise<AttemptResult | null> {
    const steps = flowStructureUtil.getAllSteps(flow.version.trigger)
    const pieces = await loadPieces({ steps, projectId, platformId, log })
    const errorsBefore = errorsOf({ validation }).length

    const proposed = await propose({ model, validation, steps, pieces, prompt, plan, log })
    if (proposed.length === 0) {
        return null
    }
    const screened = repairPatch.screen({ patches: proposed, steps, pieces })
    if (screened.applied.length === 0) {
        return {
            flow,
            validation,
            attempt: { attempt, errorsBefore, errorsAfter: errorsBefore, applied: [], rejected: screened.rejected, revertedForRegression: false },
        }
    }

    const before = snapshotOf({ steps, patches: screened.applied })
    const patched = await applyToFlow({ flow, patches: screened.applied, steps, projectId, platformId, userId, log })
    if (isNil(patched)) {
        return {
            flow,
            validation,
            attempt: { attempt, errorsBefore, errorsAfter: errorsBefore, applied: [], rejected: screened.rejected, revertedForRegression: false },
        }
    }

    const revalidated = await validate({ flow: patched, projectId, platformId, log })
    const errorsAfter = errorsOf({ validation: revalidated }).length
    if (errorsAfter < errorsBefore) {
        log.info({ project: { id: projectId }, flow: { id: flow.id }, repair: { attempt, errorsBefore, errorsAfter } }, '[flowRepair] Repair reduced the error count')
        return {
            flow: patched,
            validation: revalidated,
            attempt: { attempt, errorsBefore, errorsAfter, applied: screened.applied, rejected: screened.rejected, revertedForRegression: false },
        }
    }

    log.warn({ project: { id: projectId }, flow: { id: flow.id }, repair: { attempt, errorsBefore, errorsAfter } }, '[flowRepair] Repair did not help, reverting it')
    const reverted = await revert({ flow: patched, snapshot: before, projectId, platformId, userId, log })
    return {
        flow: reverted ?? patched,
        validation: isNil(reverted) ? revalidated : validation,
        attempt: { attempt, errorsBefore, errorsAfter, applied: [], rejected: screened.rejected, revertedForRegression: true },
    }
}

async function propose({ model, validation, steps, pieces, prompt, plan, log }: ProposeParams): Promise<RepairPatch[]> {
    const system = repairPrompt.build({ validation, steps, pieces, prompt, plan, unrepairable: UNREPAIRABLE_RULES })
    if (isNil(system)) {
        return []
    }
    const { data, error } = await tryCatch(() => withTimeout({
        promise: generateText({ model, system, prompt: repairPrompt.instruction() }),
        ms: REPAIR_TIMEOUT_MS,
    }))
    if (isNil(data)) {
        log.warn({ error }, '[flowRepair] The repair model could not be reached')
        return []
    }
    const { data: parsed } = tryCatchSync(() => JSON.parse(stripFences({ text: data.text })))
    if (!Array.isArray(parsed)) {
        return []
    }
    return parsed.flatMap((entry) => {
        const decoded = RepairPatch.safeParse(entry)
        return decoded.success ? [decoded.data] : []
    })
}

async function applyToFlow({ flow, patches, steps, projectId, platformId, userId, log }: ApplyToFlowParams): Promise<PopulatedFlow | null> {
    const byStep = groupByStep({ patches })
    let current = flow
    for (const [stepName, stepPatches] of byStep) {
        const step = steps.find((candidate) => candidate.name === stepName)
        if (isNil(step)) {
            continue
        }
        const updated = await updateStep({ flow: current, step, patched: applyPatches({ step, patches: stepPatches }), projectId, platformId, userId, log })
        if (isNil(updated)) {
            return null
        }
        current = updated
    }
    return current
}

async function revert({ flow, snapshot, projectId, platformId, userId, log }: RevertParams): Promise<PopulatedFlow | null> {
    let current = flow
    for (const [stepName, previous] of snapshot) {
        const step = flowStructureUtil.getAllSteps(current.version.trigger).find((candidate) => candidate.name === stepName)
        if (isNil(step)) {
            continue
        }
        const updated = await updateStep({ flow: current, step, patched: previous, projectId, platformId, userId, log })
        if (isNil(updated)) {
            return null
        }
        current = updated
    }
    return current
}

async function updateStep({ flow, step, patched, projectId, platformId, userId, log }: UpdateStepParams): Promise<PopulatedFlow | null> {
    const { data, error } = await tryCatch(() => flowService(log).update({
        id: flow.id,
        projectId,
        platformId,
        userId,
        previousFlow: flow,
        operation: {
            type: FlowOperationType.UPDATE_ACTION,
            request: {
                type: FlowActionType.PIECE,
                name: step.name,
                displayName: step.displayName,
                valid: false,
                skip: false,
                settings: {
                    ...step.settings,
                    actionName: patched.actionName,
                    input: patched.input,
                },
            },
        },
    }))
    if (isNil(data)) {
        log.warn({ error, step: { name: step.name } }, '[flowRepair] Could not apply the repair to the step')
        return null
    }
    return data
}

function snapshotOf({ steps, patches }: { steps: Step[], patches: RepairPatch[] }): Map<string, { actionName: string, input: Record<string, unknown> }> {
    return new Map([...groupByStep({ patches }).keys()].flatMap((stepName) => {
        const step = steps.find((candidate) => candidate.name === stepName)
        if (isNil(step)) {
            return []
        }
        return [[stepName, applyPatches({ step, patches: [] })] as const]
    }))
}

function groupByStep({ patches }: { patches: RepairPatch[] }): Map<string, RepairPatch[]> {
    return patches.reduce((grouped, patch) => {
        grouped.set(patch.stepName, [...(grouped.get(patch.stepName) ?? []), patch])
        return grouped
    }, new Map<string, RepairPatch[]>())
}

async function loadPieces({ steps, projectId, platformId, log }: LoadPiecesParams): Promise<Map<string, PieceMetadataModel | null>> {
    const names = [...new Set(steps.flatMap((step) => {
        const name = step.settings.pieceName
        return typeof name === 'string' ? [name] : []
    }))]
    const loaded = await Promise.all(names.map(async (name) => {
        const { data } = await tryCatch(() => pieceMetadataService(log).get({ name, projectId, platformId }))
        return [name, data ?? null] as const
    }))
    return new Map(loaded)
}

async function resolveModel({ projectId, platformId, log }: { projectId: string, platformId: string, log: FastifyBaseLogger }): Promise<LanguageModel | null> {
    const { data } = await tryCatch(() => aiModelResolver(log).resolveTextModel({ projectId, platformId }))
    return data?.model ?? null
}

function validate({ flow, projectId, platformId, log }: { flow: PopulatedFlow, projectId: string, platformId: string, log: FastifyBaseLogger }): Promise<ValidateGeneratedFlowResponse> {
    return flowValidator(log).validate({ flowVersion: flow.version, projectId, platformId })
}

function errorsOf({ validation }: { validation: ValidateGeneratedFlowResponse }) {
    return validation.issues.filter((issue) => issue.severity === FlowValidationSeverity.ERROR)
}

function outcomeOf({ attempts, validation, unrepairableRules }: { attempts: RepairAttempt[], validation: ValidateGeneratedFlowResponse, unrepairableRules: FlowValidationRule[] }): RepairOutcome {
    if (attempts.length === 0) {
        return RepairOutcome.NOT_ATTEMPTED
    }
    if (errorsOf({ validation }).length === 0) {
        return RepairOutcome.REPAIRED
    }
    const first = attempts[0]
    const last = attempts[attempts.length - 1]
    if (last.errorsAfter < first.errorsBefore) {
        return RepairOutcome.IMPROVED
    }
    return unrepairableRules.length > 0 ? RepairOutcome.NOT_ATTEMPTED : RepairOutcome.UNCHANGED
}

function stripFences({ text }: { text: string }): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
    return (fenced?.[1] ?? text).trim()
}

async function withTimeout<T>({ promise, ms }: { promise: Promise<T>, ms: number }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Repair timed out after ${ms}ms`)), ms)
    })
    try {
        return await Promise.race([promise, expiry])
    }
    finally {
        if (!isNil(timer)) {
            clearTimeout(timer)
        }
    }
}

type UpdateStepParams = {
    flow: PopulatedFlow
    step: Step
    patched: { actionName: string, input: Record<string, unknown> }
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type RevertParams = {
    flow: PopulatedFlow
    snapshot: Map<string, { actionName: string, input: Record<string, unknown> }>
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type ApplyToFlowParams = {
    flow: PopulatedFlow
    patches: RepairPatch[]
    steps: Step[]
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type ProposeParams = {
    model: LanguageModel
    validation: ValidateGeneratedFlowResponse
    steps: Step[]
    pieces: Map<string, PieceMetadataModel | null>
    prompt: string
    plan: WorkflowPlan | null | undefined
    log: FastifyBaseLogger
}

type AttemptResult = {
    flow: PopulatedFlow
    validation: ValidateGeneratedFlowResponse
    attempt: RepairAttempt
}

type AttemptParams = {
    attempt: number
    flow: PopulatedFlow
    validation: ValidateGeneratedFlowResponse
    model: LanguageModel
    prompt: string
    plan: WorkflowPlan | null | undefined
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type LoadPiecesParams = {
    steps: Step[]
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type RepairParams = {
    flowId: string
    projectId: string
    platformId: string
    userId: string | undefined
    prompt: string
    plan: WorkflowPlan | null | undefined
}

type FlowRepairService = {
    repair(params: RepairParams): Promise<RepairGeneratedFlowResponse>
}
