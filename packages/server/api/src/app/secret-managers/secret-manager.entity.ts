import { Platform, SecretManagerConnectionScope, SecretManagerProviderId } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'
import { EncryptedObject } from '../helper/encryption'

export const SecretManagerEntity = new EntitySchema<SecretManagerSchema>({
    name: 'secret_manager_connection',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        providerId: {
            type: String,
            nullable: false,
        },
        name: {
            type: String,
            nullable: false,
        },
        scope: {
            type: String,
            nullable: false,
            default: SecretManagerConnectionScope.PLATFORM,
        },
        projectIds: {
            type: 'jsonb',
            nullable: true,
        },
        auth: {
            type: 'jsonb',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_secret_manager_connection_platform_id',
            columns: ['platformId'],
        },
    ],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                foreignKeyConstraintName: 'fk_secret_manager_connection_platform_id',
            },
        },
    },
})

export type SecretManagerSchema = {
    id: string
    created: string
    updated: string
    platformId: string
    providerId: SecretManagerProviderId
    name: string
    scope: SecretManagerConnectionScope
    projectIds: string[] | null
    auth: EncryptedObject | null
    platform?: Platform
}
