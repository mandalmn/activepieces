import { ApId, SeekPage } from '@activepieces/core-utils'
import { CreatePlatformApiKeyRequest, PlatformApiKey, PlatformApiKeyWithValue, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { platformApiKeyService } from './platform-api-key.service'

const API_KEY_PRINCIPALS = [PrincipalType.USER] as const

export const platformApiKeyController: FastifyPluginAsyncZod = async (fastify) => {

    fastify.post('/', CreateApiKeyRequest, async (request, reply) => {
        const created = await platformApiKeyService(request.log).create({
            platformId: request.principal.platform.id,
            displayName: request.body.displayName,
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    fastify.get('/', ListApiKeysRequest, async (request) => {
        return platformApiKeyService(request.log).list({
            platformId: request.principal.platform.id,
        })
    })

    fastify.delete('/:id', DeleteApiKeyRequest, async (request, reply) => {
        await platformApiKeyService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const CreateApiKeyRequest = {
    config: {
        security: securityAccess.platformAdminOnly(API_KEY_PRINCIPALS),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Create an API key for this platform. The secret is returned once and never again.',
        body: CreatePlatformApiKeyRequest,
        response: {
            [StatusCodes.CREATED]: PlatformApiKeyWithValue,
        },
    },
}

const ListApiKeysRequest = {
    config: {
        security: securityAccess.platformAdminOnly(API_KEY_PRINCIPALS),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'List the API keys for this platform',
        response: {
            [StatusCodes.OK]: SeekPage(PlatformApiKey),
        },
    },
}

const DeleteApiKeyRequest = {
    config: {
        security: securityAccess.platformAdminOnly(API_KEY_PRINCIPALS),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Revoke an API key',
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
