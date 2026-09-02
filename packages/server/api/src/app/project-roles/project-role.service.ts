import { ActivepiecesError, apId, ErrorCode, isNil, Permission, PlatformId, ProjectRole, RoleType, SeekPage, spreadIfDefined } from '@activepieces/core-utils'
import { CreateProjectRoleRequestBody } from '@activepieces/shared'
import { Brackets } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { ProjectMemberEntity } from '../project-members/project-member.entity'
import { ProjectRoleEntity } from './project-role.entity'

export const projectRoleRepo = repoFactory(ProjectRoleEntity)
const memberRepo = repoFactory(ProjectMemberEntity)

export const projectRoleService = {
    async getOneOrThrowById({ id, platformId }: IdParams): Promise<ProjectRole> {
        const projectRole = await visibleToPlatform({ platformId })
            .andWhere('role.id = :id', { id })
            .getOne()
        if (isNil(projectRole)) {
            throw notFound({ identifier: id })
        }
        return projectRole
    },

    getOne({ name, platformId }: NameParams): Promise<ProjectRole | null> {
        return visibleToPlatform({ platformId })
            .andWhere('LOWER(role.name) = LOWER(:name)', { name })
            .getOne()
    },

    async getOneOrThrow({ name, platformId }: NameParams): Promise<ProjectRole> {
        const projectRole = await this.getOne({ name, platformId })
        if (isNil(projectRole)) {
            throw notFound({ identifier: name })
        }
        return projectRole
    },

    async list({ platformId }: { platformId: PlatformId }): Promise<SeekPage<ProjectRole>> {
        const roles = await visibleToPlatform({ platformId })
            .orderBy('role.created', 'ASC')
            .getMany()
        const counts = await countMembersByRole({ platformId, roleIds: roles.map((role) => role.id) })
        return {
            data: roles.map((role) => ({ ...role, userCount: counts.get(role.id) ?? 0 })),
            next: null,
            previous: null,
        }
    },

    async create({ platformId, request }: { platformId: PlatformId, request: CreateProjectRoleRequestBody }): Promise<ProjectRole> {
        await assertNameIsFree({ name: request.name, platformId })
        assertPermissionsAreKnown({ permissions: request.permissions })
        return projectRoleRepo().save({
            id: apId(),
            platformId,
            name: request.name,
            permissions: request.permissions,
            type: RoleType.CUSTOM,
        })
    },

    async update({ id, platformId, name, permissions }: UpdateParams): Promise<ProjectRole> {
        const existing = await this.getOneOrThrowById({ id, platformId })
        assertIsCustom({ role: existing, action: 'edited' })
        if (!isNil(name) && name.toLowerCase() !== existing.name.toLowerCase()) {
            await assertNameIsFree({ name, platformId })
        }
        if (!isNil(permissions)) {
            assertPermissionsAreKnown({ permissions })
        }
        await projectRoleRepo().update({ id, platformId }, {
            ...spreadIfDefined('name', name),
            ...spreadIfDefined('permissions', permissions),
        })
        return this.getOneOrThrowById({ id, platformId })
    },

    async delete({ name, platformId }: NameParams): Promise<void> {
        const role = await this.getOneOrThrow({ name, platformId })
        assertIsCustom({ role, action: 'deleted' })
        const assigned = await memberRepo().countBy({ projectRoleId: role.id, platformId })
        if (assigned > 0) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: `This role is still assigned to ${assigned} member(s). Move them to another role first.` },
            })
        }
        await projectRoleRepo().delete({ id: role.id, platformId })
    },
}

async function countMembersByRole({ platformId, roleIds }: { platformId: PlatformId, roleIds: string[] }): Promise<Map<string, number>> {
    if (roleIds.length === 0) {
        return new Map()
    }
    const rows = await memberRepo().createQueryBuilder('member')
        .select('member.projectRoleId', 'roleId')
        .addSelect('COUNT(*)', 'count')
        .where('member.platformId = :platformId', { platformId })
        .andWhere('member.projectRoleId IN (:...roleIds)', { roleIds })
        .groupBy('member.projectRoleId')
        .getRawMany<{ roleId: string, count: string }>()
    return new Map(rows.map((row) => [row.roleId, Number(row.count)]))
}

function visibleToPlatform({ platformId }: { platformId: PlatformId }) {
    return projectRoleRepo().createQueryBuilder('role')
        .where(new Brackets((qb) => qb
            .where('role.platformId = :platformId', { platformId })
            .orWhere('role.type = :defaultType', { defaultType: RoleType.DEFAULT })))
}

async function assertNameIsFree({ name, platformId }: NameParams): Promise<void> {
    const taken = await projectRoleService.getOne({ name, platformId })
    if (!isNil(taken)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `A role named "${name}" already exists.` },
        })
    }
}

function assertPermissionsAreKnown({ permissions }: { permissions: string[] }): void {
    const known = new Set<string>(Object.values(Permission))
    const unknown = permissions.filter((permission) => !known.has(permission))
    if (unknown.length > 0) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `Unknown permission(s): ${unknown.join(', ')}` },
        })
    }
}

function assertIsCustom({ role, action }: { role: ProjectRole, action: string }): void {
    if (role.type === RoleType.DEFAULT) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `The built-in role "${role.name}" cannot be ${action}.` },
        })
    }
}

function notFound({ identifier }: { identifier: string }): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.ENTITY_NOT_FOUND,
        params: { entityType: 'project_role', entityId: identifier },
    })
}

type IdParams = {
    id: string
    platformId: PlatformId
}

type NameParams = {
    name: string
    platformId: PlatformId
}

type UpdateParams = {
    id: string
    platformId: PlatformId
    name: string | undefined
    permissions: string[] | undefined
}
