import { apId, Cursor, isNil, sanitizeObjectForPostgresql, SeekPage } from '@activepieces/core-utils'
import { ACTIVITY_LOG_DEFAULT_PAGE_SIZE, ActivityLog, ApplicationEvent } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { LessThan } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { applicationEvents } from '../helper/application-events'
import { rejectedPromiseHandler } from '../helper/promise-handler'
import { ActivityLogEntity } from './activity-log.entity'

const activityLogRepo = repoFactory(ActivityLogEntity)

export const activityLogService = (log: FastifyBaseLogger): ActivityLogService => ({
    initListeners(): void {
        applicationEvents(log).registerListeners(log, {
            userEvent: (listenerLog) => (event): void => {
                rejectedPromiseHandler(persist({ event }), listenerLog)
            },
            workerEvent: (listenerLog) => (_projectId, event): void => {
                rejectedPromiseHandler(persist({ event }), listenerLog)
            },
        })
    },

    async list({ platformId, limit, cursor, action, projectId }: ListParams): Promise<SeekPage<ActivityLog>> {
        const pageSize = limit ?? ACTIVITY_LOG_DEFAULT_PAGE_SIZE
        const rows = await activityLogRepo().find({
            where: {
                platformId,
                ...(isNil(action) ? {} : { action }),
                ...(isNil(projectId) ? {} : { projectId }),
                ...(isNil(cursor) ? {} : { created: LessThan(cursor) }),
            },
            order: { created: 'DESC' },
            take: pageSize + 1,
        })
        const hasMore = rows.length > pageSize
        const data = hasMore ? rows.slice(0, pageSize) : rows
        return {
            data,
            next: hasMore ? data[data.length - 1].created : null,
            previous: null,
        }
    },
})

async function persist({ event }: { event: ApplicationEvent }): Promise<void> {
    const fields: ActivityLogFields = event
    const { userId, userEmail, projectId, projectDisplayName, platformId, ip, action, data } = fields
    if (isNil(platformId)) {
        return
    }
    const now = new Date().toISOString()
    await activityLogRepo().save({
        id: apId(),
        created: now,
        updated: now,
        platformId,
        projectId: projectId ?? null,
        projectDisplayName: projectDisplayName ?? null,
        userId: userId ?? null,
        userEmail: userEmail ?? null,
        action,
        ip: ip ?? null,
        data: sanitizeObjectForPostgresql(data ?? {}),
    })
}

type ActivityLogFields = {
    platformId?: string
    projectId?: string | null
    projectDisplayName?: string | null
    userId?: string | null
    userEmail?: string | null
    ip?: string | null
    action: string
    data?: Record<string, unknown>
}

type ListParams = {
    platformId: string
    limit?: number
    cursor?: Cursor
    action?: string
    projectId?: string
}

type ActivityLogService = {
    initListeners(): void
    list(params: ListParams): Promise<SeekPage<ActivityLog>>
}
