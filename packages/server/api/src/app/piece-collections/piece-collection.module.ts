import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { pieceCollectionController } from './piece-collection.controller'

export const pieceCollectionModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(pieceCollectionController, { prefix: '/v1/piece-sets' })
}
