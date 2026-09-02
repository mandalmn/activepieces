import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { platformApiKeyController } from './platform-api-key.controller'

export const platformApiKeyModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(platformApiKeyController, { prefix: '/v1/api-keys' })
}
