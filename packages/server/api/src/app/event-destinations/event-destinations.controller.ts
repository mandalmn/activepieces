import { ApId, SeekPage } from '@activepieces/core-utils'
import { CreatePlatformEventDestinationRequestBody, EventDestination, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI, UpdatePlatformEventDestinationRequestBody } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { eventDestinationService } from './event-destinations.service'

const EVENT_DESTINATION_PRINCIPALS = [PrincipalType.USER] as const
const DEFAULT_PAGE_SIZE = 50

export const eventDestinationController: FastifyPluginAsyncZod = async (fastify) => {

    fastify.get('/', ListEventDestinations, async (request) => {
        return eventDestinationService(request.log).list({
            platformId: request.principal.platform.id,
            cursorRequest: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
        })
    })

    fastify.post('/', CreateEventDestination, async (request, reply) => {
        const created = await eventDestinationService(request.log).create(request.body, request.principal.platform.id)
        return reply.status(StatusCodes.CREATED).send(created)
    })

    fastify.post('/:id', UpdateEventDestination, async (request) => {
        return eventDestinationService(request.log).update({
            id: request.params.id,
            platformId: request.principal.platform.id,
            request: request.body,
        })
    })

    fastify.delete('/:id', DeleteEventDestination, async (request, reply) => {
        await eventDestinationService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListEventDestinations = {
    config: {
        security: securityAccess.platformAdminOnly(EVENT_DESTINATION_PRINCIPALS),
    },
    schema: {
        tags: ['event-destinations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'List the event destinations for this platform',
        querystring: z.object({
            limit: z.coerce.number().int().min(1).max(100).optional(),
            cursor: z.string().optional(),
        }),
        response: {
            [StatusCodes.OK]: SeekPage(EventDestination),
        },
    },
}

const CreateEventDestination = {
    config: {
        security: securityAccess.platformAdminOnly(EVENT_DESTINATION_PRINCIPALS),
    },
    schema: {
        tags: ['event-destinations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Send platform events to a URL',
        body: CreatePlatformEventDestinationRequestBody,
        response: {
            [StatusCodes.CREATED]: EventDestination,
        },
    },
}

const UpdateEventDestination = {
    config: {
        security: securityAccess.platformAdminOnly(EVENT_DESTINATION_PRINCIPALS),
    },
    schema: {
        tags: ['event-destinations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Update an event destination',
        params: z.object({ id: ApId }),
        body: UpdatePlatformEventDestinationRequestBody,
        response: {
            [StatusCodes.OK]: EventDestination,
        },
    },
}

const DeleteEventDestination = {
    config: {
        security: securityAccess.platformAdminOnly(EVENT_DESTINATION_PRINCIPALS),
    },
    schema: {
        tags: ['event-destinations'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Delete an event destination',
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
