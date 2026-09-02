import { isNil, tryCatch } from '@activepieces/core-utils'
import { PieceMetadataModel } from '@activepieces/pieces-framework'
import {
    ActivationDecision,
    ActivationVerdict,
    AutomationLifecycle,
    FlowOperationType,
    FlowStatus,
    flowStructureUtil,
    PopulatedFlow,
    PublishGeneratedFlowResponse,
    Step,
    ValidateGeneratedFlowResponse,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { flowService } from '../../flows/flow/flow.service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { flowValidator } from '../flow-generation/flow-validator'
import { activationPolicy } from './activation-policy'

export const flowPublishService = (log: FastifyBaseLogger): FlowPublishService => ({
    async publish({ flowId, projectId, platformId, userId, approveActivation = false }: PublishParams): Promise<PublishGeneratedFlowResponse> {
        const flow = await flowService(log).getOnePopulatedOrThrow({ id: flowId, projectId })
        const validation = await flowValidator(log).validate({ flowVersion: flow.version, projectId, platformId })

        const steps = flowStructureUtil.getAllSteps(flow.version.trigger)
        const pieces = await loadPieces({ steps, projectId, platformId, log })
        const activation = activationPolicy.decide({ steps, pieces })

        if (!validation.publishable) {
            log.info({ project: { id: projectId }, flow: { id: flowId } }, '[flowPublish] Refusing to publish a flow that does not validate')
            return unpublished({ flow, validation, activation, lifecycle: AutomationLifecycle.NEEDS_SETUP })
        }

        const shouldEnable = activation.decision === ActivationDecision.AUTOMATIC || approveActivation
        const { data: published, error } = await tryCatch(() => flowService(log).update({
            id: flow.id,
            projectId,
            platformId,
            userId,
            previousFlow: flow,
            operation: {
                type: FlowOperationType.LOCK_AND_PUBLISH,
                request: { status: shouldEnable ? FlowStatus.ENABLED : FlowStatus.DISABLED },
            },
        }))
        if (isNil(published)) {
            log.warn({ error, project: { id: projectId }, flow: { id: flowId } }, '[flowPublish] Publishing failed')
            return unpublished({ flow, validation, activation, lifecycle: AutomationLifecycle.FAILED })
        }

        log.info({
            project: { id: projectId },
            flow: { id: flowId },
            publish: { enabled: shouldEnable, decision: activation.decision, holdCount: activation.holds.length },
        }, '[flowPublish] Generated flow published')

        return {
            lifecycle: published.status === FlowStatus.ENABLED ? AutomationLifecycle.ACTIVE : AutomationLifecycle.READY,
            activation,
            flowId: published.id,
            publishedVersionId: published.publishedVersionId ?? null,
            status: published.status,
            validation,
        }
    },
})

function unpublished({ flow, validation, activation, lifecycle }: UnpublishedParams): PublishGeneratedFlowResponse {
    return {
        lifecycle: isNil(flow.publishedVersionId) ? lifecycle : AutomationLifecycle.READY,
        activation,
        flowId: flow.id,
        publishedVersionId: flow.publishedVersionId ?? null,
        status: flow.status,
        validation,
    }
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

type UnpublishedParams = {
    flow: PopulatedFlow
    validation: ValidateGeneratedFlowResponse
    activation: ActivationVerdict
    lifecycle: AutomationLifecycle
}

type LoadPiecesParams = {
    steps: Step[]
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type PublishParams = {
    flowId: string
    projectId: string
    platformId: string
    userId: string | undefined
    approveActivation?: boolean
}

type FlowPublishService = {
    publish(params: PublishParams): Promise<PublishGeneratedFlowResponse>
}
