import { ErrorCode } from '@activepieces/core-utils'
import { PrincipalType, ProjectType } from '@activepieces/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { generateMockToken } from '../../../helpers/auth'
import { mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Project API (CE)', () => {
    describe('Create Project', () => {
        it('should create one team project', async () => {
            const { mockOwner, mockPlatform } = await mockAndSaveBasicSetup({
                project: { type: ProjectType.PERSONAL },
                plan: { billedTeamProjectsLimit: 1 },
            })

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockOwner.id,
                platform: { id: mockPlatform.id },
            })

            const displayName = faker.animal.bird()
            const response = await app?.inject({
                method: 'POST',
                url: '/api/v1/projects',
                body: { displayName },
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const responseBody = response?.json()
            expect(responseBody.displayName).toBe(displayName)
            expect(responseBody.ownerId).toBe(mockOwner.id)
            expect(responseBody.platformId).toBe(mockPlatform.id)
        })

        it('creates as many team projects as the team needs', async () => {
            const { mockOwner, mockPlatform } = await mockAndSaveBasicSetup({
                plan: { billedTeamProjectsLimit: 1 },
            })

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockOwner.id,
                platform: { id: mockPlatform.id },
            })

            const create = () => app?.inject({
                method: 'POST',
                url: '/api/v1/projects',
                body: { displayName: faker.animal.bird() },
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect((await create())?.statusCode).toBe(StatusCodes.CREATED)
            expect((await create())?.statusCode).toBe(StatusCodes.CREATED)
            expect((await create())?.statusCode).toBe(StatusCodes.CREATED)
        })
    })
})
