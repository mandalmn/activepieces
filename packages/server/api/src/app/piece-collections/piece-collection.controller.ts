import { ApId, SeekPage } from '@activepieces/core-utils'
import { AssignProjectsRequestBody, CreatePieceSetRequestBody, DuplicatePieceSetRequestBody, ListPieceSetsRequestQuery, PieceSet, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI, UpdatePieceSetRequestBody } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { pieceCollectionService } from './piece-collection.service'

const PIECE_COLLECTION_PRINCIPALS = [PrincipalType.USER] as const

export const pieceCollectionController: FastifyPluginAsyncZod = async (app) => {

    app.get('/', ListPieceCollections, async (request) => {
        return pieceCollectionService(request.log).list({
            platformId: request.principal.platform.id,
            limit: request.query.limit,
            cursor: request.query.cursor ?? null,
        })
    })

    app.get('/:id', GetPieceCollection, async (request) => {
        return pieceCollectionService(request.log).getOneOrThrow({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
    })

    app.post('/', CreatePieceCollection, async (request, reply) => {
        const created = await pieceCollectionService(request.log).create({
            platformId: request.principal.platform.id,
            name: request.body.name,
            key: request.body.key,
        })
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.post('/:id', UpdatePieceCollection, async (request) => {
        return pieceCollectionService(request.log).update({
            id: request.params.id,
            platformId: request.principal.platform.id,
            name: request.body.name,
            key: request.body.key,
            pieces: request.body.pieces,
            actions: request.body.actions,
            triggers: request.body.triggers,
        })
    })

    app.post('/:id/duplicate', DuplicatePieceCollection, async (request, reply) => {
        const duplicated = await pieceCollectionService(request.log).duplicate({
            id: request.params.id,
            platformId: request.principal.platform.id,
            name: request.body.name,
        })
        return reply.status(StatusCodes.CREATED).send(duplicated)
    })

    app.post('/:id/projects', AssignProjects, async (request, reply) => {
        await pieceCollectionService(request.log).assignProjects({
            id: request.params.id,
            platformId: request.principal.platform.id,
            projectIds: request.body.projectIds,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.delete('/:id/projects/:projectId', UnassignProject, async (request, reply) => {
        await pieceCollectionService(request.log).unassignProject({
            id: request.params.id,
            platformId: request.principal.platform.id,
            projectId: request.params.projectId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.delete('/:id', DeletePieceCollection, async (request, reply) => {
        await pieceCollectionService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const adminOnly = {
    security: securityAccess.platformAdminOnly(PIECE_COLLECTION_PRINCIPALS),
}

const idParams = z.object({ id: ApId })

const ListPieceCollections = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'List the piece sets for this platform',
        querystring: ListPieceSetsRequestQuery,
        response: {
            [StatusCodes.OK]: SeekPage(PieceSet),
        },
    },
}

const GetPieceCollection = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Get one piece set',
        params: idParams,
        response: {
            [StatusCodes.OK]: PieceSet,
        },
    },
}

const CreatePieceCollection = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Create a piece set',
        body: CreatePieceSetRequestBody,
        response: {
            [StatusCodes.CREATED]: PieceSet,
        },
    },
}

const UpdatePieceCollection = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Update a piece set',
        params: idParams,
        body: UpdatePieceSetRequestBody,
        response: {
            [StatusCodes.OK]: PieceSet,
        },
    },
}

const DuplicatePieceCollection = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Duplicate a piece set',
        params: idParams,
        body: DuplicatePieceSetRequestBody,
        response: {
            [StatusCodes.CREATED]: PieceSet,
        },
    },
}

const AssignProjects = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Assign projects to a piece set',
        params: idParams,
        body: AssignProjectsRequestBody,
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}

const UnassignProject = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Remove a project from a piece set',
        params: z.object({ id: ApId, projectId: ApId }),
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}

const DeletePieceCollection = {
    config: adminOnly,
    schema: {
        tags: ['piece-sets'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Delete a piece set',
        params: idParams,
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}
