import { AppConnectionScope, AppConnectionType, AppConnectionWithoutSensitiveData, PackageType, PieceType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { createMockPieceMetadata } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function seedPieceMetadata(ctx: TestContext): Promise<string> {
    const piece = createMockPieceMetadata({
        platformId: ctx.platform.id,
        packageType: PackageType.REGISTRY,
        pieceType: PieceType.CUSTOM,
        minimumSupportedRelease: '0.0.0',
        maximumSupportedRelease: '999.999.999',
    })
    await db.save('piece_metadata', piece)
    return piece.name
}

function secretTextConnection({ displayName, pieceName, projectIds }: { displayName: string, pieceName: string, projectIds: string[] }) {
    return {
        displayName,
        pieceName,
        scope: AppConnectionScope.PLATFORM,
        projectIds,
        type: AppConnectionType.SECRET_TEXT,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: 'a-secret-value',
        },
    }
}

describe('Global Connection API', () => {
    it('creates a platform-scoped connection without echoing the secret', async () => {
        const ctx = await createTestContext(app)
        const pieceName = await seedPieceMetadata(ctx)

        const response = await ctx.post('/v1/global-connections', secretTextConnection({
            displayName: 'shared connection',
            pieceName,
            projectIds: [ctx.project.id],
        }))

        expect(response?.statusCode).toBe(StatusCodes.CREATED)
        const body = response?.json()
        expect(body.scope).toBe(AppConnectionScope.PLATFORM)
        expect(body.displayName).toBe('shared connection')
        expect(body.platformId).toBe(ctx.platform.id)
        expect(body.value).toBeUndefined()
    })

    it('lists, renames and deletes a global connection', async () => {
        const ctx = await createTestContext(app)
        const pieceName = await seedPieceMetadata(ctx)

        const created = await ctx.post('/v1/global-connections', secretTextConnection({
            displayName: 'first name',
            pieceName,
            projectIds: [ctx.project.id],
        }))
        expect(created?.statusCode).toBe(StatusCodes.CREATED)
        const id = created?.json().id

        const listed = await ctx.get('/v1/global-connections')
        expect(listed?.statusCode).toBe(StatusCodes.OK)
        const rows: AppConnectionWithoutSensitiveData[] = listed?.json().data ?? []
        expect(rows.some((row) => row.id === id)).toBe(true)
        expect(rows.every((row) => row.value === undefined)).toBe(true)

        const renamed = await ctx.post(`/v1/global-connections/${id}`, {
            displayName: 'second name',
            projectIds: [ctx.project.id],
        })
        expect(renamed?.statusCode).toBe(StatusCodes.OK)
        expect(renamed?.json().displayName).toBe('second name')

        const deleted = await ctx.delete(`/v1/global-connections/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const afterDelete = await ctx.get('/v1/global-connections')
        const remaining: AppConnectionWithoutSensitiveData[] = afterDelete?.json().data ?? []
        expect(remaining.some((row) => row.id === id)).toBe(false)
    })

    it('never leaks another platform connections', async () => {
        const first = await createTestContext(app)
        const pieceName = await seedPieceMetadata(first)
        const second = await createTestContext(app)

        await first.post('/v1/global-connections', secretTextConnection({
            displayName: 'first platform only',
            pieceName,
            projectIds: [first.project.id],
        }))

        const response = await second.get('/v1/global-connections')
        const rows: AppConnectionWithoutSensitiveData[] = response?.json().data ?? []

        expect(rows.every((row) => row.platformId === second.platform.id)).toBe(true)
        expect(rows.some((row) => row.displayName === 'first platform only')).toBe(false)
    })

    it('rejects a piece that does not exist', async () => {
        const ctx = await createTestContext(app)

        const response = await ctx.post('/v1/global-connections', secretTextConnection({
            displayName: 'unknown piece',
            pieceName: '@activepieces/piece-does-not-exist',
            projectIds: [ctx.project.id],
        }))

        expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
    })
})
