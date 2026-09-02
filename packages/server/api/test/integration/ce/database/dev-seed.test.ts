import { ApEnvironment } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { FlagEntity } from '../../../../src/app/flags/flag.entity'
import { devDataSeed } from '../../../../src/app/database/seeds/dev-seeds'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null
let previousEnvironment: string | undefined

const DEV_EMAIL = 'dev@ap.com'
const DEV_DATA_SEEDED_FLAG = 'DEV_DATA_SEEDED'

function countOf(table: string): Promise<number> {
    return databaseConnection().getRepository(table).count()
}

async function seedAsDevelopment(): Promise<void> {
    previousEnvironment = process.env.AP_ENVIRONMENT
    process.env.AP_ENVIRONMENT = ApEnvironment.DEVELOPMENT
    try {
        await databaseConnection().getRepository(FlagEntity).delete({ id: DEV_DATA_SEEDED_FLAG })
        await devDataSeed.run()
    }
    finally {
        if (previousEnvironment === undefined) {
            delete process.env.AP_ENVIRONMENT
        }
        else {
            process.env.AP_ENVIRONMENT = previousEnvironment
        }
    }
}

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Seeding a database that has never been seeded', () => {
    it('provisions the dev user with a platform and a project', async () => {
        app = await setupTestEnvironment()

        await seedAsDevelopment()

        const identity = await databaseConnection()
            .getRepository('user_identity')
            .findOneByOrFail({ email: DEV_EMAIL })
        const users = await databaseConnection()
            .getRepository('user')
            .findBy({ identityId: identity.id })

        expect(users.length).toBeGreaterThan(0)
        expect(await countOf('platform')).toBeGreaterThan(0)
        expect(await countOf('project')).toBeGreaterThan(0)
    })

    it('is safe to run a second time on an already seeded database', async () => {
        app = await setupTestEnvironment()

        await seedAsDevelopment()
        const platformsAfterFirst = await countOf('platform')

        await expect(seedAsDevelopment()).resolves.toBeUndefined()
        expect(await countOf('platform')).toBe(platformsAfterFirst)
    })
})
