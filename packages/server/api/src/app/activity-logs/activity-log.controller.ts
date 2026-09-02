import { SeekPage } from '@activepieces/core-utils'
import { ActivityLog, ListActivityLogsRequest, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { activityLogService } from './activity-log.service'

const ACTIVITY_LOG_PRINCIPALS = [PrincipalType.USER] as const

export const activityLogController: FastifyPluginAsyncZod = async (fastify) => {

    fastify.get('/', ListActivityLogs, async (request) => {
        return activityLogService(request.log).list({
            platformId: request.principal.platform.id,
            limit: request.query.limit,
            cursor: request.query.cursor,
            action: request.query.action,
            projectId: request.query.projectId,
        })
    })
}

const ListActivityLogs = {
    config: {
        security: securityAccess.platformAdminOnly(ACTIVITY_LOG_PRINCIPALS),
    },
    schema: {
        tags: ['activity-logs'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'List activity for this platform, newest first',
        querystring: ListActivityLogsRequest,
        response: {
            [StatusCodes.OK]: SeekPage(ActivityLog),
        },
    },
}
