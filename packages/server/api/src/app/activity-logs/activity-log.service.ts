import { apId, Cursor, isNil, sanitizeObjectForPostgresql, SeekPage } from '@activepieces/core-utils'
import { ACTIVITY_LOG_DEFAULT_PAGE_SIZE, ActivityLog, ApplicationEvent } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
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
        const query = activityLogRepo()
            .createQueryBuilder('activity_log')
            .where('activity_log."platformId" = :platformId', { platformId })
            .orderBy('activity_log.created', 'DESC')
            .addOrderBy('activity_log.id', 'DESC')
            .take(pageSize + 1)
        if (!isNil(action)) {
            query.andWhere('activity_log.action = :action', { action })
        }
        if (!isNil(projectId)) {
            query.andWhere('activity_log."projectId" = :projectId', { projectId })
        }
        const decoded = decodeCursor(cursor)
        if (!isNil(decoded)) {
            query.andWhere(
                '(activity_log.created < :created OR (activity_log.created = :created AND activity_log.id < :id))',
                decoded,
            )
        }
        const rows = await query.getMany()
        const hasMore = rows.length > pageSize
        const data = hasMore ? rows.slice(0, pageSize) : rows
        const last = data[data.length - 1]
        return {
            data,
            next: hasMore && !isNil(last) ? encodeCursor({ created: last.created, id: last.id }) : null,
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

function encodeCursor({ created, id }: { created: string, id: string }): string {
    return `${new Date(created).toISOString()}|${id}`
}

function decodeCursor(cursor: string | null | undefined): { created: string, id: string } | null {
    if (isNil(cursor)) {
        return null
    }
    const separatorAt = cursor.lastIndexOf('|')
    if (separatorAt < 0) {
        return null
    }
    const created = new Date(cursor.slice(0, separatorAt))
    if (Number.isNaN(created.getTime())) {
        return null
    }
    return { created: created.toISOString(), id: cursor.slice(separatorAt + 1) }
}
