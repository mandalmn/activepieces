import { ApplicationEventName, EventDestination } from '@activepieces/shared'
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

describe('Event Destination API', () => {
    it('creates a destination for the current platform', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/event-destinations', {
            url: 'https://example.com/hook',
            events: [ApplicationEventName.FLOW_CREATED],
        })

        expect(response?.statusCode).toBe(StatusCodes.CREATED)
        const body = response?.json()
        expect(body.url).toBe('https://example.com/hook')
        expect(body.events).toEqual([ApplicationEventName.FLOW_CREATED])
        expect(body.platformId).toBe(ctx.platform.id)
    })

    it('lists, updates and deletes a destination', async () => {
        const ctx = await createTestContext(app!)

        const created = await ctx.post('/v1/event-destinations', {
            url: 'https://example.com/first',
            events: [ApplicationEventName.FLOW_CREATED],
        })
        const id = created?.json().id

        const listed = await ctx.get('/v1/event-destinations')
        expect(listed?.statusCode).toBe(StatusCodes.OK)
        const rows: EventDestination[] = listed?.json().data ?? []
        expect(rows.some((row) => row.id === id)).toBe(true)

        const updated = await ctx.post(`/v1/event-destinations/${id}`, {
            url: 'https://example.com/second',
            events: [ApplicationEventName.FLOW_DELETED],
        })
        expect(updated?.statusCode).toBe(StatusCodes.OK)
        expect(updated?.json().url).toBe('https://example.com/second')

        const deleted = await ctx.delete(`/v1/event-destinations/${id}`)
        expect(deleted?.statusCode).toBe(StatusCodes.NO_CONTENT)

        const afterDelete = await ctx.get('/v1/event-destinations')
        const remaining: EventDestination[] = afterDelete?.json().data ?? []
        expect(remaining.some((row) => row.id === id)).toBe(false)
    })

    it('never leaks another platform destinations', async () => {
        const first = await createTestContext(app!)
        const second = await createTestContext(app!)

        await first.post('/v1/event-destinations', {
            url: 'https://example.com/first-platform',
            events: [ApplicationEventName.FLOW_CREATED],
        })

        const response = await second.get('/v1/event-destinations')
        const rows: EventDestination[] = response?.json().data ?? []

        expect(rows.every((row) => row.platformId === second.platform.id)).toBe(true)
        expect(rows.some((row) => row.url === 'https://example.com/first-platform')).toBe(false)
    })

    it('rejects an invalid url', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/event-destinations', {
            url: 'not-a-url',
            events: [ApplicationEventName.FLOW_CREATED],
        })

        expect(response?.statusCode).toBe(StatusCodes.BAD_REQUEST)
    })
})
