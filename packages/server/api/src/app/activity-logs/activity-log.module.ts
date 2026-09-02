import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { activityLogController } from './activity-log.controller'
import { activityLogService } from './activity-log.service'

export const activityLogModule: FastifyPluginAsyncZod = async (app) => {
    activityLogService(app.log).initListeners()
    await app.register(activityLogController, { prefix: '/v1/activity-logs' })
}
