import { PieceSelectionMode, PieceSet } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Piece Set API', () => {
    it('creates a set that starts by including every piece', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/piece-sets', { name: 'starter set' })

        expect(response?.statusCode).toBe(StatusCodes.CREATED)
        const body: PieceSet = response?.json()
        expect(body.name).toBe('starter set')
        expect(body.platformId).toBe(ctx.platform.id)
        expect(body.isDefault).toBe(false)
        expect(body.config.pieces.mode).toBe(PieceSelectionMode.INCLUDE_ALL)
        expect(body.config.pieces.exceptions).toEqual([])
    })

    it('updates the piece selection and reads it back', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/piece-sets', { name: 'curated' })
        const id = created?.json().id

        const updated = await ctx.post(`/v1/piece-sets/${id}`, {
            pieces: {
                mode: PieceSelectionMode.EXCLUDE_ALL,
                exceptions: ['@activepieces/piece-slack'],
            },
        })

        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().config.pieces.mode).toBe(PieceSelectionMode.EXCLUDE_ALL)

        const fetched = await ctx.get(`/v1/piece-sets/${id}`)
        expect(fetched?.json().config.pieces.exceptions).toEqual(['@activepieces/piece-slack'])
    })

    it('narrows actions for one piece and clears them again', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/piece-sets', { name: 'action scoped' })
        const id = created?.json().id

        const narrowed = await ctx.post(`/v1/piece-sets/${id}`, {
            actions: { '@activepieces/piece-slack': { mode: 'selected', selected: ['send_message'] } },
        })
        expect(narrowed?.json().config.selectedActions['@activepieces/piece-slack']).toEqual(['send_message'])

        const cleared = await ctx.post(`/v1/piece-sets/${id}`, {
            actions: { '@activepieces/piece-slack': { mode: 'all' } },
        })
        expect(cleared?.json().config.selectedActions['@activepieces/piece-slack']).toBeUndefined()
    })

    it('duplicates a set including its configuration', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/piece-sets', { name: 'source set' })
        const id = created?.json().id
        await ctx.post(`/v1/piece-sets/${id}`, {
            pieces: { mode: PieceSelectionMode.EXCLUDE_ALL, exceptions: ['@activepieces/piece-store'] },
        })

        const copy = await ctx.post(`/v1/piece-sets/${id}/duplicate`, { name: 'copied set' })

        expect(copy?.statusCode).toBe(StatusCodes.CREATED)
        expect(copy?.json().name).toBe('copied set')
        expect(copy?.json().id).not.toBe(id)
        expect(copy?.json().config.pieces.exceptions).toEqual(['@activepieces/piece-store'])
    })

    it('assigns and unassigns a project', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/piece-sets', { name: 'assigned set' })
        const id = created?.json().id

        const assigned = await ctx.post(`/v1/piece-sets/${id}/projects`, { projectIds: [ctx.project.id] })
        expect(assigned?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const unassigned = await ctx.delete(`/v1/piece-sets/${id}/projects/${ctx.project.id}`)
        expect(unassigned?.statusCode).toBe(StatusCodes.NO_CONTENT)
    })

    it('refuses to assign a project from another platform', async () => {
        const owner = await createTestContext(app!)
        const stranger = await createTestContext(app!)
        const created = await owner.post('/v1/piece-sets', { name: 'guarded set' })
        const id = created?.json().id

        const response = await owner.post(`/v1/piece-sets/${id}/projects`, { projectIds: [stranger.project.id] })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('never leaks another platform sets', async () => {
        const first = await createTestContext(app!)
        const second = await createTestContext(app!)
        await first.post('/v1/piece-sets', { name: 'first platform set' })

        const listed = await second.get('/v1/piece-sets')
        const rows: PieceSet[] = listed?.json().data ?? []

        expect(rows.every((row) => row.platformId === second.platform.id)).toBe(true)
        expect(rows.some((row) => row.name === 'first platform set')).toBe(false)
    })

    it('deletes a set', async () => {
        const ctx = await createTestContext(app!)
        const created = await ctx.post('/v1/piece-sets', { name: 'doomed set' })
        const id = created?.json().id

        const deleted = await ctx.delete(`/v1/piece-sets/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const fetched = await ctx.get(`/v1/piece-sets/${id}`)
        expect(fetched?.statusCode).toBe(StatusCodes.NOT_FOUND)
    })

    it('rejects an empty name', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/piece-sets', { name: '' })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })
})
