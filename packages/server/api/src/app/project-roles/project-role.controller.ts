import { SeekPage } from '@activepieces/core-utils'
import {
    CreateProjectRoleRequestBody,
    ListProjectMembersForProjectRoleRequestQuery,
    PrincipalType,
    ProjectMemberWithUser,
    UpdateProjectRoleRequestBody,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { projectMemberService } from '../project-members/project-member.service'
import { projectRoleService } from './project-role.service'

const DEFAULT_LIMIT_SIZE = 10

export const projectRoleController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListProjectRoles, async (request) => {
        return projectRoleService.list({ platformId: request.principal.platform.id })
    })

    app.get('/:id', GetProjectRole, async (request) => {
        return projectRoleService.getOneOrThrowById({ id: request.params.id, platformId: request.principal.platform.id })
    })

    app.get('/:id/project-members', ListMembersWithRole, async (request) => {
        await projectRoleService.getOneOrThrowById({ id: request.params.id, platformId: request.principal.platform.id })
        return projectMemberService(request.log).list({
            platformId: request.principal.platform.id,
            projectRoleId: request.params.id,
            cursorRequest: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_LIMIT_SIZE,
        })
    })

    app.post('/', CreateProjectRole, async (request, reply) => {
        const projectRole = await projectRoleService.create({
            platformId: request.principal.platform.id,
            request: request.body,
        })
        return reply.status(StatusCodes.CREATED).send(projectRole)
    })

    app.post('/:id', UpdateProjectRole, async (request) => {
        return projectRoleService.update({
            id: request.params.id,
            platformId: request.principal.platform.id,
            name: request.body.name,
            permissions: request.body.permissions,
        })
    })

    app.delete('/:name', DeleteProjectRole, async (request, reply) => {
        await projectRoleService.delete({
            name: request.params.name,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListProjectRoles = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
}

const GetProjectRole = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        params: z.object({ id: z.string() }),
    },
}

const ListMembersWithRole = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        params: z.object({ id: z.string() }),
        querystring: ListProjectMembersForProjectRoleRequestQuery,
        response: {
            [StatusCodes.OK]: SeekPage(ProjectMemberWithUser),
        },
    },
}

const CreateProjectRole = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        body: CreateProjectRoleRequestBody,
    },
}

const UpdateProjectRole = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        params: z.object({ id: z.string() }),
        body: UpdateProjectRoleRequestBody,
    },
}

const DeleteProjectRole = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        params: z.object({ name: z.string() }),
    },
}
