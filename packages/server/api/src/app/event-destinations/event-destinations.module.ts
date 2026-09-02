import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { eventDestinationController } from './event-destinations.controller'
import { eventDestinationService } from './event-destinations.service'

export const eventDestinationModule: FastifyPluginAsyncZod = async (app) => {
    eventDestinationService(app.log).setup()
    await app.register(eventDestinationController, { prefix: '/v1/event-destinations' })
}
