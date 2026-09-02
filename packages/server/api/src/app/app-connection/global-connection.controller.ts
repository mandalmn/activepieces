import { ApId, SeekPage } from '@activepieces/core-utils'
import { AppConnectionScope, AppConnectionWithoutSensitiveData, ListGlobalConnectionsRequestQuery, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI, UpdateGlobalConnectionValueRequestBody, UpsertGlobalConnectionRequestBody } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { securityHelper } from '../helper/security-helper'
import { appConnectionService } from './app-connection-service/app-connection-service'

const GLOBAL_CONNECTION_PRINCIPALS = [PrincipalType.USER, PrincipalType.SERVICE] as const
const DEFAULT_PAGE_SIZE = 10

export const globalConnectionController: FastifyPluginAsyncZod = async (app) => {

    app.post('/', UpsertGlobalConnection, async (request, reply) => {
        const ownerId = await securityHelper.getUserIdFromRequest(request)
        const connection = await appConnectionService(request.log).upsert({
            platformId: request.principal.platform.id,
            projectIds: request.body.projectIds,
            scope: AppConnectionScope.PLATFORM,
            ownerId,
            externalId: request.body.externalId ?? request.body.displayName,
            displayName: request.body.displayName,
            pieceName: request.body.pieceName,
            type: request.body.type,
            value: request.body.value,
            metadata: request.body.metadata,
            preSelectForNewProjects: request.body.preSelectForNewProjects,
        })
        return reply.status(StatusCodes.CREATED).send(connection)
    })

    app.post('/:id', UpdateGlobalConnection, async (request) => {
        return appConnectionService(request.log).update({
            platformId: request.principal.platform.id,
            id: request.params.id,
            projectIds: null,
            scope: AppConnectionScope.PLATFORM,
            request: {
                displayName: request.body.displayName,
                projectIds: request.body.projectIds ?? null,
                metadata: request.body.metadata,
                preSelectForNewProjects: request.body.preSelectForNewProjects,
            },
        })
    })

    app.get('/', ListGlobalConnections, async (request): Promise<SeekPage<AppConnectionWithoutSensitiveData>> => {
        const connections = await appConnectionService(request.log).list({
            platformId: request.principal.platform.id,
            projectId: null,
            scope: AppConnectionScope.PLATFORM,
            pieceName: request.query.pieceName,
            displayName: request.query.displayName,
            status: request.query.status,
            limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
            cursorRequest: request.query.cursor ?? null,
            projectIds: undefined,
            externalIds: undefined,
            ownerIds: undefined,
        })

        return {
            ...connections,
            data: connections.data.map(appConnectionService(request.log).removeSensitiveData),
        }
    })

    app.delete('/:id', DeleteGlobalConnection, async (request, reply) => {
        await appConnectionService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
            projectId: null,
            scope: AppConnectionScope.PLATFORM,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const UpsertGlobalConnection = {
    config: {
        security: securityAccess.platformAdminOnly(GLOBAL_CONNECTION_PRINCIPALS),
    },
    schema: {
        tags: ['global-connections'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Create a connection shared across the whole platform',
        body: UpsertGlobalConnectionRequestBody,
        response: {
            [StatusCodes.CREATED]: AppConnectionWithoutSensitiveData,
        },
    },
}

const UpdateGlobalConnection = {
    config: {
        security: securityAccess.platformAdminOnly(GLOBAL_CONNECTION_PRINCIPALS),
    },
    schema: {
        tags: ['global-connections'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Update a global connection',
        params: z.object({ id: ApId }),
        body: UpdateGlobalConnectionValueRequestBody,
        response: {
            [StatusCodes.OK]: AppConnectionWithoutSensitiveData,
        },
    },
}

const ListGlobalConnections = {
    config: {
        security: securityAccess.platformAdminOnly(GLOBAL_CONNECTION_PRINCIPALS),
    },
    schema: {
        tags: ['global-connections'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'List the connections shared across the whole platform',
        querystring: ListGlobalConnectionsRequestQuery,
        response: {
            [StatusCodes.OK]: SeekPage(AppConnectionWithoutSensitiveData),
        },
    },
}

const DeleteGlobalConnection = {
    config: {
        security: securityAccess.platformAdminOnly(GLOBAL_CONNECTION_PRINCIPALS),
    },
    schema: {
        tags: ['global-connections'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Delete a global connection',
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
