import { PieceSet } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

type PieceCollectionSchema = PieceSet & {
    projectIds: string[]
}

export const PieceCollectionEntity = new EntitySchema<PieceCollectionSchema>({
    name: 'piece_collection',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: ApIdSchema,
        name: {
            type: String,
        },
        key: {
            type: String,
            nullable: true,
        },
        isDefault: {
            type: Boolean,
            default: false,
        },
        generatedForProjectId: {
            ...ApIdSchema,
            nullable: true,
        },
        config: {
            type: 'jsonb',
        },
        projectIds: {
            type: String,
            array: true,
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_piece_collection_platform_id',
            columns: ['platformId'],
            unique: false,
        },
        {
            name: 'idx_piece_collection_platform_id_key',
            columns: ['platformId', 'key'],
            unique: true,
        },
    ],
})
