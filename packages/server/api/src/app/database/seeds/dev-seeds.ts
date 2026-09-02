import { isNil } from '@activepieces/core-utils'
import { ApEnvironment, UserIdentityProvider } from '@activepieces/shared'
import { authenticationService } from '../../authentication/authentication.service'
import { userIdentityService } from '../../authentication/user-identity/user-identity-service'
import { FlagEntity } from '../../flags/flag.entity'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { platformService } from '../../platform/platform.service'
import { databaseConnection } from '../database-connection'
import { DataSeed } from './data-seed'

const DEV_DATA_SEEDED_FLAG = 'DEV_DATA_SEEDED'
const log = system.globalLogger()

const currentEnvIsNotDev = (): boolean => {
    const env = system.get(AppSystemProp.ENVIRONMENT)
    return env !== ApEnvironment.DEVELOPMENT
}

const devDataAlreadySeeded = async (): Promise<boolean> => {
    const flagRepo = databaseConnection().getRepository(FlagEntity)
    const devSeedsFlag = await flagRepo.findOneBy({ id: DEV_DATA_SEEDED_FLAG })
    return devSeedsFlag?.value === true
}

const setDevDataSeededFlag = async (): Promise<void> => {
    const flagRepo = databaseConnection().getRepository(FlagEntity)

    await flagRepo.save({
        id: DEV_DATA_SEEDED_FLAG,
        value: true,
    })
}

const seedDevUser = async (): Promise<void> => {
    const DEV_EMAIL = 'dev@ap.com'
    const DEV_PASSWORD = '12345678'


    const existingIdentity = await userIdentityService(log).getIdentityByEmail(DEV_EMAIL)
    if (isNil(existingIdentity)) {
        await authenticationService(log).signUp({
            email: DEV_EMAIL,
            password: DEV_PASSWORD,
            firstName: 'Dev',
            lastName: 'User',
            trackEvents: false,
            platformId: null,
            newsLetter: false,
            provider: UserIdentityProvider.EMAIL,
        })
    }

    const identity = await userIdentityService(log).getIdentityByEmail(DEV_EMAIL)
    if (isNil(identity)) {
        log.warn({ email: DEV_EMAIL }, '[devSeeds#seedDevUser] Sign up did not create an identity, skipping')
        return
    }

    await platformService(log).createPlatformWithProject({
        identityId: identity.id,
        name: 'dev\'s Platform',
        invalidatePreviousTokens: true,
        isFirstPlatform: true,
        callerTokenVersion: undefined,
    })

    log.info({ email: DEV_EMAIL, password: DEV_PASSWORD }, '[devSeeds#seedDevUser] Dev user and platform created')
}
const seedDevData = async (): Promise<void> => {
    if (currentEnvIsNotDev()) {
        log.info('[devSeeds#seedDevData] Skipping, not in development environment')
        return
    }

    if (await devDataAlreadySeeded()) {
        log.info('[devSeeds#seedDevData] Skipping, already seeded')
        return
    }

    await seedDevUser()
    await setDevDataSeededFlag()
}

export const devDataSeed: DataSeed = {
    run: seedDevData,
}
