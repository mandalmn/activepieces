import { Permission, SeekPage } from '@activepieces/core-utils'
import {
    GetCurrentProjectMemberRoleQuery,
    ListProjectMembersRequestQuery,
    PrincipalType,
    ProjectMemberWithUser,
    SERVICE_KEY_SECURITY_OPENAPI,
    UpdateProjectMemberRoleRequestBody,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { ProjectMemberEntity } from './project-member.entity'
import { projectMemberService } from './project-member.service'

const DEFAULT_LIMIT_SIZE = 10

export const projectMemberController: FastifyPluginAsyncZod = async (app) => {
    app.get('/role', GetCurrentRole, async (request) => {
        return projectMemberService(request.log).getRole({
            projectId: request.projectId,
            userId: request.principal.id,
        })
    })

    app.get('/', ListProjectMembers, async (request) => {
        return projectMemberService(request.log).list({
            platformId: request.principal.platform.id,
            projectId: request.projectId,
            projectRoleId: request.query.projectRoleId ?? undefined,
            cursorRequest: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_LIMIT_SIZE,
        })
    })

    app.post('/:id', UpdateProjectMemberRole, async (request) => {
        return projectMemberService(request.log).update({
            id: request.params.id,
            role: request.body.role,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
        })
    })

    app.delete('/:id', DeleteProjectMember, async (request, reply) => {
        await projectMemberService(request.log).delete({
            id: request.params.id,
            projectId: request.projectId,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const GetCurrentRole = {
    config: {
        security: securityAccess.project([PrincipalType.USER], undefined, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        querystring: GetCurrentProjectMemberRoleQuery,
    },
}

const ListProjectMembers = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.READ_PROJECT_MEMBER, {
            type: ProjectResourceType.QUERY,
        }),
    },
    schema: {
        tags: ['project-members'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        querystring: ListProjectMembersRequestQuery,
        response: {
            [StatusCodes.OK]: SeekPage(ProjectMemberWithUser),
        },
    },
}

const UpdateProjectMemberRole = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT_MEMBER, {
            type: ProjectResourceType.TABLE,
            tableName: ProjectMemberEntity,
        }),
    },
    schema: {
        params: z.object({ id: z.string() }),
        body: UpdateProjectMemberRoleRequestBody,
        response: {
            [StatusCodes.OK]: ProjectMemberWithUser,
        },
    },
}

const DeleteProjectMember = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.SERVICE], Permission.WRITE_PROJECT_MEMBER, {
            type: ProjectResourceType.TABLE,
            tableName: ProjectMemberEntity,
        }),
    },
    schema: {
        tags: ['project-members'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: z.object({ id: z.string() }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
