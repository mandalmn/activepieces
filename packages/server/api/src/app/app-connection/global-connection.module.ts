import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { globalConnectionController } from './global-connection.controller'

export const communityGlobalConnectionModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(globalConnectionController, { prefix: '/v1/global-connections' })
}
