import { ActivityLog } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

type ActivityLogSchema = ActivityLog

export const ActivityLogEntity = new EntitySchema<ActivityLogSchema>({
    name: 'activity_log',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: ApIdSchema,
        projectId: {
            ...ApIdSchema,
            nullable: true,
        },
        projectDisplayName: {
            type: String,
            nullable: true,
        },
        userId: {
            ...ApIdSchema,
            nullable: true,
        },
        userEmail: {
            type: String,
            nullable: true,
        },
        action: {
            type: String,
        },
        ip: {
            type: String,
            nullable: true,
        },
        data: {
            type: 'jsonb',
            default: {},
        },
    },
    indices: [
        {
            name: 'idx_activity_log_platform_id_created',
            columns: ['platformId', 'created'],
            unique: false,
        },
        {
            name: 'idx_activity_log_project_id',
            columns: ['projectId'],
            unique: false,
        },
    ],
})
