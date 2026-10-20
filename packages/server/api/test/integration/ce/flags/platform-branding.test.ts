import { ApFlagId } from '@activepieces/shared'
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

describe('Platform branding on community edition', () => {
    it('serves the branding the platform carries, not the Activepieces default', async () => {
        const ctx = await createTestContext(app!, {
            platform: {
                name: 'Mandal Pieces',
                fullLogoUrl: 'https://mandal.mn/full-logo.png',
                logoIconUrl: 'https://mandal.mn/icon.svg',
                favIconUrl: 'https://mandal.mn/favicon.svg',
                primaryColor: '#1d4ed8',
            },
        })

        const flags = await ctx.get('/v1/flags')
        expect(flags?.statusCode).toBe(StatusCodes.OK)

        const theme = flags?.json()[ApFlagId.THEME]
        expect(theme.websiteName).toBe('Mandal Pieces')
        expect(theme.logos.fullLogoUrl).toBe('https://mandal.mn/full-logo.png')
        expect(theme.logos.favIconUrl).toBe('https://mandal.mn/favicon.svg')
        expect(JSON.stringify(theme)).not.toContain('Activepieces')
    })

    it('renames the platform and the flags follow', async () => {
        const ctx = await createTestContext(app!)

        const saved = await ctx.post(`/v1/platforms/${ctx.platform.id}`, { name: 'Mandal Automation' })
        expect(saved?.statusCode).toBe(StatusCodes.OK)

        const theme = (await ctx.get('/v1/flags'))?.json()[ApFlagId.THEME]
        expect(theme.websiteName).toBe('Mandal Automation')
    })
})
