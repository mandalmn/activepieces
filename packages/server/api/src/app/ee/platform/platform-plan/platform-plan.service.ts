import { apId, isEmpty, isNil } from '@activepieces/core-utils'
import { ApEdition, AUTUMN_FREE_PLAN, OPEN_SOURCE_PLAN, PlatformPlan, PlatformPlanLimits, PlatformPlanWithOnlyLimits } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager } from 'typeorm'
import { repoFactory } from '../../../core/db/repo-factory'
import { getPlatformPlanNameKey, PLATFORM_PLAN_NAME_TTL_SECONDS } from '../../../database/redis/keys'
import { distributedLock, distributedStore } from '../../../database/redis-connections'
import { system } from '../../../helper/system/system'
import { PlatformPlanEntity } from './platform-plan.entity'

export const platformPlanRepo = repoFactory(PlatformPlanEntity)

type UpdatePlatformBillingParams = {
    platformId: string
} & Partial<PlatformPlanLimits>

const edition = system.getEdition()

export const platformPlanService = (log: FastifyBaseLogger) => ({

    async getOrCreateForPlatform(platformId: string): Promise<PlatformPlan> {
        const existingPlatformPlan = await platformPlanRepo().findOneBy({ platformId })
        if (!isNil(existingPlatformPlan)) {
            return existingPlatformPlan
        }

        const platformPlan = await distributedLock(log).runExclusive({
            key: `platform_plan_${platformId}`,
            timeoutInSeconds: 60,
            fn: async () => {
                const platformPlan = await platformPlanRepo().findOneBy({ platformId })
                if (!isNil(platformPlan)) return platformPlan
                return createInitialBilling(platformId)
            },
        })
        return platformPlan
    },

    async onPlatformCreated(platformId: string): Promise<void> {
        await createInitialBilling(platformId)
    },

    async update(params: UpdatePlatformBillingParams): Promise<PlatformPlan> {
        const { platformId, ...update } = params
        log.info({ platform: { id: platformId } }, 'updating platform billing')

        const normalizedUpdate = Object.fromEntries(
            Object.entries(update).map(([key, value]) => [key, value === undefined ? null : value]),
        )

        if (!isEmpty(normalizedUpdate)) {
            await platformPlanRepo().update({ platformId }, normalizedUpdate)
        }

        const updatedPlatformPlan = await platformPlanRepo().findOneByOrFail({ platformId })
        if (!isNil(updatedPlatformPlan.plan)) {
            await distributedStore.put(getPlatformPlanNameKey(platformId), updatedPlatformPlan.plan, PLATFORM_PLAN_NAME_TTL_SECONDS)
        }
        else {
            await distributedStore.delete(getPlatformPlanNameKey(platformId))
        }
        return updatedPlatformPlan
    },
})









function getInitialPlanByEdition(): PlatformPlanWithOnlyLimits {
    switch (edition) {
        case ApEdition.COMMUNITY:
            return OPEN_SOURCE_PLAN
        case ApEdition.ENTERPRISE:
        case ApEdition.CLOUD:
            return AUTUMN_FREE_PLAN
    }
}

async function createInitialBilling(platformId: string): Promise<PlatformPlan> {
    const plan = getInitialPlanByEdition()

    const platformPlan: Omit<PlatformPlan, 'created' | 'updated'> = {
        ...plan,
        id: apId(),
        platformId,
    }
    const savedPlatformPlan = await platformPlanRepo().save(platformPlan)
    if (!isNil(savedPlatformPlan.plan)) {
        await distributedStore.put(getPlatformPlanNameKey(platformId), savedPlatformPlan.plan, PLATFORM_PLAN_NAME_TTL_SECONDS)
    }

    return savedPlatformPlan
}






export type CheckUsersExceededLimitParams = {
    platformId: string
    entityManager: EntityManager
    additionalSeatsNeeded?: number
}

export type CountUsedSeatsParams = {
    platformId: string
    log: FastifyBaseLogger
    entityManager?: EntityManager
}

export type SeatBreakdown = {
    activeUsers: number
    invitedSeats: number
    usedSeats: number
}