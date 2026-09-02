import { PlatformApiKey } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

type PlatformApiKeySchema = PlatformApiKey & {
    hashedValue: string
}

export const PlatformApiKeyEntity = new EntitySchema<PlatformApiKeySchema>({
    name: 'platform_api_key',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: ApIdSchema,
        displayName: {
            type: String,
        },
        hashedValue: {
            type: String,
        },
        truncatedValue: {
            type: String,
        },
        lastUsedAt: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_platform_api_key_hashed_value',
            columns: ['hashedValue'],
            unique: true,
        },
        {
            name: 'idx_platform_api_key_platform_id',
            columns: ['platformId'],
            unique: false,
        },
    ],
})
