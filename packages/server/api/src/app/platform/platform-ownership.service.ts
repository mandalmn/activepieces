import { ActivepiecesError, ErrorCode } from '@activepieces/core-utils'
import { PlatformRole, UserStatus } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { transaction } from '../core/db/transaction'
import { projectRepo } from '../project/project-repo'
import { userService } from '../user/user-service'
import { platformRepo, platformService } from './platform.service'

export const platformOwnershipService = (log: FastifyBaseLogger): PlatformOwnershipService => ({
    async transfer({ platformId, newOwnerId, currentUserId }: TransferParams): Promise<void> {
        const platform = await platformService(log).getOneOrThrow(platformId)
        if (platform.ownerId !== currentUserId) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: { message: 'Only the current platform owner can transfer ownership' },
            })
        }
        if (platform.ownerId === newOwnerId) {
            return
        }
        const newOwner = await userService(log).getOneOrFail({ id: newOwnerId })
        if (newOwner.platformId !== platformId) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: { message: 'The new owner must belong to this platform' },
            })
        }
        if (newOwner.platformRole !== PlatformRole.ADMIN) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'The new owner must be a platform admin' },
            })
        }
        if (newOwner.status !== UserStatus.ACTIVE) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: { message: 'The new owner must be an active user' },
            })
        }
        await transaction(async (entityManager) => {
            await platformRepo(entityManager).update({ id: platformId }, { ownerId: newOwnerId })
            await projectRepo(entityManager).update({ platformId, ownerId: platform.ownerId }, { ownerId: newOwnerId })
        })
        log.info({ platform: { id: platformId }, user: { id: newOwnerId } }, '[platformOwnership#transfer] Platform ownership transferred')
    },
})

type TransferParams = {
    platformId: string
    newOwnerId: string
    currentUserId: string
}

type PlatformOwnershipService = {
    transfer(params: TransferParams): Promise<void>
}
