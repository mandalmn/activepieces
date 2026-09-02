import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { secretManagerController } from './secret-manager.controller'

export const secretManagerModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(secretManagerController, { prefix: '/v1/secret-managers' })
}
