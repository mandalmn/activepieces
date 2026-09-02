import { isNil, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import {
    EditFlowResponse,
    FlowEdit,
    FlowEditOutcome,
    FlowReadiness,
    MAX_EDITS_PER_TURN,
    PopulatedFlow,
    PublishGeneratedFlowResponse,
    RejectedEdit,
    ValidateGeneratedFlowResponse,
} from '@activepieces/shared'
import { generateText } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../flows/flow/flow.service'
import { aiModelResolver } from '../ai-model-resolver'
import { flowValidator } from '../flow-generation/flow-validator'
import { flowRepairService } from '../flow-generation/repair/flow-repair.service'
import { flowPublishService } from '../publish/flow-publish.service'
import { editApplier } from './edit-applier'
import { editPrompt } from './edit-prompt'

const EDIT_TIMEOUT_MS = 30_000

export const flowEditService = (log: FastifyBaseLogger): FlowEditService => ({
    async edit({ flowId, projectId, platformId, userId, instruction }: EditParams): Promise<EditFlowResponse> {
        const flow = await flowService(log).getOnePopulatedOrThrow({ id: flowId, projectId })
        const wasPublished = !isNil(flow.publishedVersionId)

        const model = await resolveModel({ projectId, platformId, log })
        if (isNil(model)) {
            return unchanged({
                outcome: FlowEditOutcome.UNAVAILABLE,
                explanation: 'No AI provider is configured for this project',
                validation: await validate({ flow, projectId, platformId, log }),
            })
        }

        const edits = await proposeEdits({ model, flow, instruction, projectId, platformId, log })
        if (edits.length === 0) {
            return unchanged({
                outcome: FlowEditOutcome.NOT_UNDERSTOOD,
                explanation: 'That change was not clear enough to apply to this automation',
                validation: await validate({ flow, projectId, platformId, log }),
            })
        }

        const applied: FlowEdit[] = []
        const rejected: RejectedEdit[] = []
        let current = flow
        for (const edit of edits.slice(0, MAX_EDITS_PER_TURN)) {
            const result = await editApplier(log).apply({ edit, flow: current, projectId, platformId, userId })
            if (isNil(result.flow)) {
                rejected.push({ edit, rejection: result.rejection ?? 'APPLY_FAILED' as RejectedEdit['rejection'] })
                continue
            }
            current = result.flow
            applied.push(edit)
        }

        if (applied.length === 0) {
            return unchanged({
                outcome: FlowEditOutcome.NOTHING_APPLIED,
                explanation: explanationOf({ applied, rejected }),
                validation: await validate({ flow: current, projectId, platformId, log }),
                rejected,
            })
        }

        let validation = await validate({ flow: current, projectId, platformId, log })
        if (validation.readiness === FlowReadiness.NEEDS_REPAIR) {
            const repaired = await flowRepairService(log).repair({ flowId, projectId, platformId, userId, prompt: instruction, plan: null })
            validation = repaired.validation
        }

        const publication = await republish({ wasPublished, validation, flowId, projectId, platformId, userId, log })

        log.info({
            project: { id: projectId },
            flow: { id: flowId },
            edit: { appliedCount: applied.length, rejectedCount: rejected.length, readiness: validation.readiness },
        }, '[flowEdit] Conversational edit applied')

        return {
            outcome: FlowEditOutcome.APPLIED,
            explanation: explanationOf({ applied, rejected }),
            applied,
            rejected,
            validation,
            publication,
        }
    },
})

async function republish({ wasPublished, validation, flowId, projectId, platformId, userId, log }: RepublishParams): Promise<PublishGeneratedFlowResponse | null> {
    if (!wasPublished || validation.readiness !== FlowReadiness.READY) {
        return null
    }
    const { data } = await tryCatch(() => flowPublishService(log).publish({ flowId, projectId, platformId, userId }))
    return data ?? null
}

async function proposeEdits({ model, flow, instruction, projectId, platformId, log }: ProposeParams): Promise<FlowEdit[]> {
    const system = await editPrompt.build({ flow, projectId, platformId, log })
    const { data, error } = await tryCatch(() => withTimeout({
        promise: generateText({ model, system, prompt: instruction }),
        ms: EDIT_TIMEOUT_MS,
    }))
    if (isNil(data)) {
        log.warn({ error, project: { id: projectId } }, '[flowEdit] The edit model could not be reached')
        return []
    }
    const { data: parsed } = tryCatchSync(() => JSON.parse(stripFences({ text: data.text })))
    if (!Array.isArray(parsed)) {
        return []
    }
    return parsed.flatMap((entry) => {
        const decoded = FlowEdit.safeParse(entry)
        return decoded.success ? [decoded.data] : []
    })
}

function explanationOf({ applied, rejected }: { applied: FlowEdit[], rejected: RejectedEdit[] }): string {
    const done = applied.map((edit) => edit.reason)
    const skipped = rejected.map((entry) => `could not ${entry.edit.reason.toLowerCase()}`)
    const parts = [...done, ...skipped]
    return parts.length === 0 ? 'Nothing changed' : parts.join('. ')
}

function unchanged({ outcome, explanation, validation, rejected = [] }: UnchangedParams): EditFlowResponse {
    return { outcome, explanation, applied: [], rejected, validation, publication: null }
}

function validate({ flow, projectId, platformId, log }: { flow: PopulatedFlow, projectId: string, platformId: string, log: FastifyBaseLogger }): Promise<ValidateGeneratedFlowResponse> {
    return flowValidator(log).validate({ flowVersion: flow.version, projectId, platformId })
}

async function resolveModel({ projectId, platformId, log }: { projectId: string, platformId: string, log: FastifyBaseLogger }) {
    const { data } = await tryCatch(() => aiModelResolver(log).resolveTextModel({ projectId, platformId }))
    return data?.model ?? null
}

function stripFences({ text }: { text: string }): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
    return (fenced?.[1] ?? text).trim()
}

async function withTimeout<T>({ promise, ms }: { promise: Promise<T>, ms: number }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Edit timed out after ${ms}ms`)), ms)
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

type RepublishParams = {
    wasPublished: boolean
    validation: ValidateGeneratedFlowResponse
    flowId: string
    projectId: string
    platformId: string
    userId: string | undefined
    log: FastifyBaseLogger
}

type ProposeParams = {
    model: Parameters<typeof generateText>[0]['model']
    flow: PopulatedFlow
    instruction: string
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type UnchangedParams = {
    outcome: FlowEditOutcome
    explanation: string
    validation: ValidateGeneratedFlowResponse
    rejected?: RejectedEdit[]
}

type EditParams = {
    flowId: string
    projectId: string
    platformId: string
    userId: string | undefined
    instruction: string
}

type FlowEditService = {
    edit(params: EditParams): Promise<EditFlowResponse>
}
