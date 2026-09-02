import { ActivepiecesError, ErrorCode, isNil } from '@activepieces/core-utils'
import { ConnectSecretManagerRequestSchema, PlatformRole, Principal, PrincipalType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { projectService } from '../project/project-service'
import { projectMemberService } from '../project-members/project-member.service'
import { userService } from '../user/user-service'
import { secretManagerService } from './secret-manager.service'

export const secretManagerController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListSecretManagers, async (request) => {
        await assertCanList({ principal: request.principal, projectId: request.query.projectId, log: request.log })
        return secretManagerService(request.log).list({
            platformId: request.principal.platform.id,
            projectId: request.query.projectId,
        })
    })

    app.post('/', CreateSecretManager, async (request, reply) => {
        const created = await secretManagerService(request.log).create({
            platformId: request.principal.platform.id,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.post('/:id', UpdateSecretManager, async (request) => {
        return secretManagerService(request.log).update({
            id: request.params.id,
            platformId: request.principal.platform.id,
            request: request.body,
        })
    })

    app.delete('/cache', ClearSecretManagerCache, async (request, reply) => {
        await secretManagerService(request.log).clearCache({
            platformId: request.principal.platform.id,
            connectionId: request.query.connectionId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.delete('/:id', DeleteSecretManager, async (request, reply) => {
        await secretManagerService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

async function assertCanList({ principal, projectId, log }: AssertCanListParams): Promise<void> {
    if (principal.type !== PrincipalType.USER) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'Only a signed-in user can list secret managers.' },
        })
    }
    if (isNil(projectId)) {
        const user = await userService(log).getOneOrFail({ id: principal.id })
        if (user.platformRole !== PlatformRole.ADMIN) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: { message: 'Listing secret managers across the platform requires a platform admin.' },
            })
        }
        return
    }
    const project = await projectService(log).getOneOrThrow(projectId)
    if (project.platformId !== principal.platform.id) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'You do not have access to this project.' },
        })
    }
    const role = await projectMemberService(log).getRole({ projectId, userId: principal.id })
    if (isNil(role)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'You do not have access to this project.' },
        })
    }
}

const ListSecretManagers = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
    schema: {
        querystring: z.object({
            projectId: z.string().optional(),
        }),
    },
}

const CreateSecretManager = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: ConnectSecretManagerRequestSchema,
    },
}

const UpdateSecretManager = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({ id: z.string() }),
        body: ConnectSecretManagerRequestSchema,
    },
}

const DeleteSecretManager = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({ id: z.string() }),
    },
}

const ClearSecretManagerCache = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        querystring: z.object({
            connectionId: z.string().optional(),
        }),
    },
}

type AssertCanListParams = {
    principal: Principal
    projectId: string | undefined
    log: FastifyBaseLogger
}
