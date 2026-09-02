import { ActivepiecesError, apId, Cursor, ErrorCode, isNil, SeekPage, unique } from '@activepieces/core-utils'
import { ComponentIntent, PieceSelection, PieceSelectionMode, PieceSet, PieceSetConfig } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { ArrayContains, In } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { projectRepo } from '../project/project-repo'
import { PieceCollectionEntity } from './piece-collection.entity'

export const pieceCollectionRepo = repoFactory(PieceCollectionEntity)

export const pieceCollectionService = (_log: FastifyBaseLogger): PieceCollectionService => ({
    async create({ platformId, name, key }: CreateParams): Promise<PieceSet> {
        return persist({ platformId, name, key: key ?? null, isDefault: false, config: emptyConfig() })
    },

    async getOneOrThrow({ id, platformId }: IdParams): Promise<PieceSet> {
        const collection = await pieceCollectionRepo().findOneBy({ id, platformId })
        if (isNil(collection)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: { entityType: 'piece_collection', entityId: id },
            })
        }
        return collection
    },

    async list({ platformId, limit, cursor }: ListParams): Promise<SeekPage<PieceSet>> {
        const rows = await pieceCollectionRepo().find({
            where: { platformId },
            order: { created: 'DESC' },
            take: limit + 1,
            skip: isNil(cursor) ? 0 : Number.parseInt(cursor, 10),
        })
        const hasMore = rows.length > limit
        const data = hasMore ? rows.slice(0, limit) : rows
        const consumed = (isNil(cursor) ? 0 : Number.parseInt(cursor, 10)) + data.length
        return {
            data,
            next: hasMore ? String(consumed) : null,
            previous: null,
        }
    },

    async update({ id, platformId, name, key, pieces, actions, triggers }: UpdateParams): Promise<PieceSet> {
        const existing = await pieceCollectionService(_log).getOneOrThrow({ id, platformId })
        const config: PieceSetConfig = {
            pieces: pieces ?? existing.config.pieces,
            selectedActions: applyIntents({ current: existing.config.selectedActions, intents: actions }),
            selectedTriggers: applyIntents({ current: existing.config.selectedTriggers, intents: triggers }),
        }
        await pieceCollectionRepo().update({ id, platformId }, {
            name: name ?? existing.name,
            key: key ?? existing.key,
            config,
        })
        return pieceCollectionService(_log).getOneOrThrow({ id, platformId })
    },

    async duplicate({ id, platformId, name }: DuplicateParams): Promise<PieceSet> {
        const source = await pieceCollectionService(_log).getOneOrThrow({ id, platformId })
        return persist({ platformId, name, key: null, isDefault: false, config: source.config })
    },

    async delete({ id, platformId }: IdParams): Promise<void> {
        const collection = await pieceCollectionService(_log).getOneOrThrow({ id, platformId })
        if (collection.isDefault) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'The default piece collection cannot be deleted' },
            })
        }
        await pieceCollectionRepo().delete({ id, platformId })
    },

    async assignProjects({ id, platformId, projectIds }: AssignParams): Promise<void> {
        const collection = await findRowOrThrow({ id, platformId })
        const owned = await projectRepo().findBy({ id: In(projectIds), platformId })
        if (owned.length !== projectIds.length) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: { message: 'One or more projects do not belong to this platform' },
            })
        }
        await releaseProjectsFromOtherCollections({ platformId, projectIds, keepCollectionId: id })
        await pieceCollectionRepo().update({ id, platformId }, {
            projectIds: unique([...collectionProjectIds(collection), ...projectIds]),
        })
    },

    async unassignProject({ id, platformId, projectId }: UnassignParams): Promise<void> {
        const collection = await findRowOrThrow({ id, platformId })
        await pieceCollectionRepo().update({ id, platformId }, {
            projectIds: collectionProjectIds(collection).filter((assigned) => assigned !== projectId),
        })
    },

    async resolveForProject({ platformId, projectId }: ResolveParams): Promise<PieceSetConfig | null> {
        const assigned = await pieceCollectionRepo().findOneBy({ platformId, projectIds: ArrayContains([projectId]) })
        if (!isNil(assigned)) {
            return assigned.config
        }
        const fallback = await pieceCollectionRepo().findOneBy({ platformId, isDefault: true })
        return fallback?.config ?? null
    },
})

async function persist({ platformId, name, key, isDefault, config }: PersistParams): Promise<PieceSet> {
    const now = new Date().toISOString()
    return pieceCollectionRepo().save({
        id: apId(),
        created: now,
        updated: now,
        platformId,
        name,
        key,
        isDefault,
        generatedForProjectId: null,
        config,
        projectIds: [],
    })
}

async function releaseProjectsFromOtherCollections({ platformId, projectIds, keepCollectionId }: { platformId: string, projectIds: string[], keepCollectionId: string }): Promise<void> {
    const collections = await pieceCollectionRepo().findBy({ platformId })
    for (const collection of collections) {
        if (collection.id === keepCollectionId) {
            continue
        }
        const remaining = collectionProjectIds(collection).filter((assigned) => !projectIds.includes(assigned))
        if (remaining.length !== collectionProjectIds(collection).length) {
            await pieceCollectionRepo().update({ id: collection.id, platformId }, { projectIds: remaining })
        }
    }
}

async function findRowOrThrow({ id, platformId }: { id: string, platformId: string }): Promise<PieceCollectionRow> {
    const collection = await pieceCollectionRepo().findOneBy({ id, platformId })
    if (isNil(collection)) {
        throw new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { entityType: 'piece_collection', entityId: id },
        })
    }
    return collection
}

function collectionProjectIds(collection: PieceCollectionRow): string[] {
    return collection.projectIds ?? []
}

function emptyConfig(): PieceSetConfig {
    return {
        pieces: { mode: PieceSelectionMode.INCLUDE_ALL, exceptions: [] },
        selectedActions: {},
        selectedTriggers: {},
    }
}

function applyIntents({ current, intents }: { current: Record<string, string[]>, intents: Record<string, ComponentIntent> | undefined }): Record<string, string[]> {
    if (isNil(intents)) {
        return current
    }
    return Object.entries(intents).reduce<Record<string, string[]>>((accumulator, [pieceName, intent]) => {
        if (intent.mode === 'all') {
            const { [pieceName]: _removed, ...rest } = accumulator
            return rest
        }
        return { ...accumulator, [pieceName]: intent.selected }
    }, current)
}

type PieceCollectionRow = PieceSet & {
    projectIds: string[]
}

type PersistParams = {
    platformId: string
    name: string
    key: string | null
    isDefault: boolean
    config: PieceSetConfig
}

type CreateParams = {
    platformId: string
    name: string
    key?: string
}

type IdParams = {
    id: string
    platformId: string
}

type ListParams = {
    platformId: string
    limit: number
    cursor?: Cursor
}

type UpdateParams = IdParams & {
    name?: string
    key?: string
    pieces?: PieceSelection
    actions?: Record<string, ComponentIntent>
    triggers?: Record<string, ComponentIntent>
}

type DuplicateParams = IdParams & {
    name: string
}

type AssignParams = IdParams & {
    projectIds: string[]
}

type UnassignParams = IdParams & {
    projectId: string
}

type ResolveParams = {
    platformId: string
    projectId: string
}

type PieceCollectionService = {
    create(params: CreateParams): Promise<PieceSet>
    getOneOrThrow(params: IdParams): Promise<PieceSet>
    list(params: ListParams): Promise<SeekPage<PieceSet>>
    update(params: UpdateParams): Promise<PieceSet>
    duplicate(params: DuplicateParams): Promise<PieceSet>
    delete(params: IdParams): Promise<void>
    assignProjects(params: AssignParams): Promise<void>
    unassignProject(params: UnassignParams): Promise<void>
    resolveForProject(params: ResolveParams): Promise<PieceSetConfig | null>
}
