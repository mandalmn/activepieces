import { ApId, BaseModelSchema, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export const ACTIVITY_LOG_DEFAULT_PAGE_SIZE = 20
export const ACTIVITY_LOG_MAX_PAGE_SIZE = 100

export const ActivityLog = z.object({
    ...BaseModelSchema,
    platformId: ApId,
    projectId: Nullable(z.string()),
    projectDisplayName: Nullable(z.string()),
    userId: Nullable(z.string()),
    userEmail: Nullable(z.string()),
    action: z.string(),
    ip: Nullable(z.string()),
    data: z.record(z.string(), z.unknown()),
})

export const ListActivityLogsRequest = z.object({
    limit: z.coerce.number().int().min(1).max(ACTIVITY_LOG_MAX_PAGE_SIZE).optional(),
    cursor: z.string().optional(),
    action: z.string().optional(),
    projectId: z.string().optional(),
})

export type ActivityLog = z.infer<typeof ActivityLog>
export type ListActivityLogsRequest = z.infer<typeof ListActivityLogsRequest>
