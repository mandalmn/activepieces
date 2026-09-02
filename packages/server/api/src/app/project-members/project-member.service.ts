import { ActivepiecesError, apId, Cursor, ErrorCode, isNil, PlatformId, ProjectId, ProjectRole, SeekPage, UserId } from '@activepieces/core-utils'
import { DefaultProjectRole, PlatformRole, ProjectMember, ProjectMemberWithUser } from '@activepieces/shared'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { buildPaginator } from '../helper/pagination/build-paginator'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { projectService } from '../project/project-service'
import { projectRoleService } from '../project-roles/project-role.service'
import { UserSchema } from '../user/user-entity'
import { userService } from '../user/user-service'
import { ProjectMemberEntity, ProjectMemberSchema } from './project-member.entity'

export const projectMemberRepo = repoFactory(ProjectMemberEntity)

export const projectMemberService = (log: FastifyBaseLogger) => ({
    async list({ platformId, projectId, projectRoleId, cursorRequest, limit }: ListParams): Promise<SeekPage<ProjectMemberWithUser>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest)
        const paginator = buildPaginator({
            entity: ProjectMemberEntity,
            query: {
                limit,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const query = projectMemberRepo()
            .createQueryBuilder('project_member')
            .leftJoinAndSelect('project_member.user', 'user')
            .leftJoinAndSelect('user.identity', 'identity')
            .leftJoinAndSelect('project_member.projectRole', 'projectRole')
            .leftJoinAndSelect('project_member.project', 'project')
            .where({ platformId })
        if (!isNil(projectId)) {
            query.andWhere({ projectId })
        }
        if (!isNil(projectRoleId)) {
            query.andWhere({ projectRoleId })
        }

        const { data, cursor } = await paginator.paginate(query)
        const members = data.flatMap((member) => {
            const enriched = toMemberWithUser(member)
            return isNil(enriched) ? [] : [enriched]
        })
        return paginationHelper.createPage<ProjectMemberWithUser>(members, cursor)
    },

    async getRole({ projectId, userId }: RoleParams): Promise<ProjectRole | null> {
        const project = await projectService(log).getOneOrThrow(projectId)
        const user = await userService(log).getOneOrFail({ id: userId })

        const implicitRole = implicitRoleOf({ user, project })
        if (!isNil(implicitRole)) {
            return projectRoleService.getOneOrThrow({ name: implicitRole, platformId: project.platformId })
        }

        const member = await projectMemberRepo().findOneBy({ projectId, userId })
        if (isNil(member)) {
            return null
        }
        return projectRoleService.getOneOrThrowById({ id: member.projectRoleId, platformId: project.platformId })
    },

    async upsert({ userId, projectId, projectRoleName }: UpsertParams): Promise<ProjectMember> {
        const { platformId } = await projectService(log).getOneOrThrow(projectId)
        const existing = await projectMemberRepo().findOneBy({ projectId, userId, platformId })
        const id = existing?.id ?? apId()
        const projectRole = await projectRoleService.getOneOrThrow({ name: projectRoleName, platformId })

        await projectMemberRepo().upsert({
            id,
            updated: dayjs().toISOString(),
            userId,
            platformId,
            projectId,
            projectRoleId: projectRole.id,
        }, ['projectId', 'userId', 'platformId'])

        return projectMemberRepo().findOneOrFail({ where: { id } })
    },

    async update({ id, projectId, platformId, role }: UpdateParams): Promise<ProjectMemberWithUser> {
        const projectRole = await projectRoleService.getOneOrThrow({ name: role, platformId })
        const member = await projectMemberRepo().findOneBy({ id, projectId, platformId })
        if (isNil(member)) {
            throw notFound({ id })
        }
        await projectMemberRepo().update({ id, projectId, platformId }, { projectRoleId: projectRole.id })
        return this.getOneWithUserOrThrow({ id, platformId })
    },

    async getOneWithUserOrThrow({ id, platformId }: { id: string, platformId: PlatformId }): Promise<ProjectMemberWithUser> {
        const row = await projectMemberRepo()
            .createQueryBuilder('project_member')
            .leftJoinAndSelect('project_member.user', 'user')
            .leftJoinAndSelect('user.identity', 'identity')
            .leftJoinAndSelect('project_member.projectRole', 'projectRole')
            .leftJoinAndSelect('project_member.project', 'project')
            .where({ id, platformId })
            .getOne()
        const enriched = isNil(row) ? null : toMemberWithUser(row)
        if (isNil(enriched)) {
            throw notFound({ id })
        }
        return enriched
    },

    async delete({ id, projectId, platformId }: DeleteParams): Promise<void> {
        const member = await projectMemberRepo().findOneBy({ id, projectId, platformId })
        if (isNil(member)) {
            throw notFound({ id })
        }
        await projectMemberRepo().delete({ id, projectId, platformId })
    },

    async listProjectIdsWithPermission({ userId, platformId, permission }: PermissionParams): Promise<ProjectId[]> {
        const rows = await projectMemberRepo()
            .createQueryBuilder('project_member')
            .select('project_member.projectId', 'projectId')
            .innerJoin('project_member.projectRole', 'project_role')
            .innerJoin('project_member.project', 'project')
            .where('project_member.userId = :userId', { userId })
            .andWhere('project_member.platformId = :platformId', { platformId })
            .andWhere(':permission = ANY(project_role.permissions)', { permission })
            .andWhere('project.deleted IS NULL')
            .getRawMany<{ projectId: ProjectId }>()
        return rows.map((row) => row.projectId)
    },
})

function implicitRoleOf({ user, project }: ImplicitRoleParams): DefaultProjectRole | null {
    if (user.id === project.ownerId) {
        return DefaultProjectRole.ADMIN
    }
    if (user.platformId !== project.platformId) {
        return null
    }
    if (user.platformRole === PlatformRole.ADMIN) {
        return DefaultProjectRole.ADMIN
    }
    if (user.platformRole === PlatformRole.OPERATOR) {
        return DefaultProjectRole.EDITOR
    }
    return null
}

function toMemberWithUser(member: ProjectMemberSchema): ProjectMemberWithUser | null {
    const { project, projectRole } = member
    if (isNil(project) || !isNil(project.deleted)) {
        return null
    }
    const user = member.user
    const identity = (user as UserSchema | undefined)?.identity
    if (isNil(user) || isNil(identity)) {
        return null
    }
    return {
        id: member.id,
        created: member.created,
        updated: member.updated,
        platformId: member.platformId,
        projectId: member.projectId,
        userId: member.userId,
        projectRoleId: member.projectRoleId,
        projectRole,
        project: {
            id: project.id,
            displayName: project.displayName,
        },
        user: {
            id: user.id,
            platformId: user.platformId,
            platformRole: user.platformRole,
            status: user.status,
            externalId: user.externalId,
            email: identity.email,
            firstName: identity.firstName,
            lastName: identity.lastName,
            created: user.created,
            updated: user.updated,
        },
    }
}

function notFound({ id }: { id: string }): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.ENTITY_NOT_FOUND,
        params: { entityType: 'project_member', entityId: id },
    })
}

type ImplicitRoleParams = {
    user: {
        id: string
        platformId?: string | null
        platformRole: PlatformRole
    }
    project: {
        ownerId: string
        platformId: string
    }
}

type ListParams = {
    platformId: PlatformId
    projectId?: ProjectId
    projectRoleId?: string
    cursorRequest: Cursor | null
    limit: number
}

type RoleParams = {
    projectId: ProjectId
    userId: UserId
}

type UpsertParams = {
    userId: UserId
    projectId: ProjectId
    projectRoleName: string
}

type UpdateParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
    role: string
}

type DeleteParams = {
    id: string
    projectId: ProjectId
    platformId: PlatformId
}

type PermissionParams = {
    userId: UserId
    platformId: PlatformId
    permission: string
}
