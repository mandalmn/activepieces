import { Permission } from '@activepieces/core-utils'
import { EditFlowRequest, EditFlowResponse, GenerateFlowFromPromptRequest, GenerateFlowFromPromptResponse, PlanWorkflowRequest, PlanWorkflowResponse, PrincipalType, PublishGeneratedFlowRequest, PublishGeneratedFlowResponse, RepairGeneratedFlowRequest, RepairGeneratedFlowResponse, ResolveWorkflowPlanRequest, ResolveWorkflowPlanResponse, SERVICE_KEY_SECURITY_OPENAPI, ValidateGeneratedFlowRequest, ValidateGeneratedFlowResponse } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { flowService } from '../flows/flow/flow.service'
import { aiFlowBuilderService } from './ai-flow-builder.service'
import { flowEditService } from './edit/flow-edit.service'
import { flowValidator } from './flow-generation/flow-validator'
import { flowRepairService } from './flow-generation/repair/flow-repair.service'
import { flowPublishService } from './publish/flow-publish.service'
import { workflowPlanResolverService } from './resolver/workflow-plan-resolver.service'
import { workflowPlannerService } from './workflow-planner.service'

const AI_FLOW_BUILDER_PRINCIPALS = [PrincipalType.USER, PrincipalType.SERVICE] as const

export const aiFlowBuilderController: FastifyPluginAsyncZod = async (fastify) => {

    fastify.post('/plan', PlanWorkflow, async (request) => {
        return workflowPlannerService(request.log).plan({
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            prompt: request.body.prompt,
            timezone: request.body.timezone,
        })
    })

    fastify.post('/resolve', ResolveWorkflowPlan, async (request) => {
        return workflowPlanResolverService(request.log).resolve({
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            plan: request.body.plan,
        })
    })

    fastify.post('/validate', ValidateGeneratedFlow, async (request) => {
        const flow = await flowService(request.log).getOnePopulatedOrThrow({
            id: request.body.flowId,
            projectId: request.projectId,
        })
        return flowValidator(request.log).validate({
            flowVersion: flow.version,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
        })
    })

    fastify.post('/repair', RepairGeneratedFlow, async (request) => {
        return flowRepairService(request.log).repair({
            flowId: request.body.flowId,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            prompt: request.body.prompt,
            plan: request.body.plan,
        })
    })

    fastify.post('/publish', PublishGeneratedFlow, async (request) => {
        return flowPublishService(request.log).publish({
            flowId: request.body.flowId,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            approveActivation: request.body.approveActivation,
        })
    })

    fastify.post('/edit', EditFlow, async (request) => {
        return flowEditService(request.log).edit({
            flowId: request.body.flowId,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            instruction: request.body.instruction,
        })
    })

    fastify.post('/generate', GenerateFlowRequest, async (request, reply) => {
        const result = await aiFlowBuilderService(request.log).generateFromPrompt({
            projectId: request.projectId,
            platformId: request.principal.platform.id,
            userId: request.principal.id,
            prompt: request.body.prompt,
            plan: request.body.plan,
        })
        return reply.status(StatusCodes.OK).send(result)
    })
}

const PlanWorkflow = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Interpret a natural language request as a provider independent workflow plan',
        body: PlanWorkflowRequest,
        response: {
            [StatusCodes.OK]: PlanWorkflowResponse,
        },
    },
}

const ResolveWorkflowPlan = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Resolve a workflow plan into the exact pieces, actions and triggers that carry it out',
        body: ResolveWorkflowPlanRequest,
        response: {
            [StatusCodes.OK]: ResolveWorkflowPlanResponse,
        },
    },
}

const ValidateGeneratedFlow = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Check a generated flow against the piece schemas before it is published',
        body: ValidateGeneratedFlowRequest,
        response: {
            [StatusCodes.OK]: ValidateGeneratedFlowResponse,
        },
    },
}

const RepairGeneratedFlow = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Diagnose and repair the configuration of a generated flow that failed validation',
        body: RepairGeneratedFlowRequest,
        response: {
            [StatusCodes.OK]: RepairGeneratedFlowResponse,
        },
    },
}

const PublishGeneratedFlow = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Publish a generated flow that validates, and activate it when it is safe to do so',
        body: PublishGeneratedFlowRequest,
        response: {
            [StatusCodes.OK]: PublishGeneratedFlowResponse,
        },
    },
}

const EditFlow = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Change an existing automation from a plain language instruction',
        body: EditFlowRequest,
        response: {
            [StatusCodes.OK]: EditFlowResponse,
        },
    },
}

const GenerateFlowRequest = {
    config: {
        security: securityAccess.project(AI_FLOW_BUILDER_PRINCIPALS, Permission.WRITE_FLOW, {
            type: ProjectResourceType.BODY,
        }),
    },
    schema: {
        tags: ['ai-flow-builder'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Generate a flow from a natural language prompt',
        body: GenerateFlowFromPromptRequest,
        response: {
            [StatusCodes.OK]: GenerateFlowFromPromptResponse,
        },
    },
}
