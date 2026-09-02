import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { aiFlowBuilderController } from './ai-flow-builder.controller'

export const aiFlowBuilderModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(aiFlowBuilderController, { prefix: '/v1/ai-flow-builder' })
}
