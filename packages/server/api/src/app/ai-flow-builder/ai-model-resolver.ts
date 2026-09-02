import { isNil, tryCatch } from '@activepieces/core-utils'
import { agentAiUtils } from '@activepieces/server-utils'
import { AIProviderModelType } from '@activepieces/shared'
import { LanguageModel } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { aiProviderService, ProviderScope } from '../ai/ai-provider-service'

export enum ModelResolutionFailure {
    NO_PROVIDER = 'NO_PROVIDER',
    NO_TEXT_MODEL = 'NO_TEXT_MODEL',
}

export const aiModelResolver = (log: FastifyBaseLogger): AiModelResolver => ({
    async resolveTextModel({ projectId, platformId }: ResolveParams): Promise<ResolvedModel> {
        const providers = await aiProviderService(log).listForProject({ platformId, projectId })
        if (providers.length === 0) {
            return { model: null, failure: ModelResolutionFailure.NO_PROVIDER }
        }
        const scope: ProviderScope = { type: 'project', projectId }
        for (const provider of providers) {
            for (const key of provider.keys) {
                const { data: models } = await tryCatch(() => aiProviderService(log).listModels({ platformId, provider: provider.provider, scope, configId: key.id }))
                const textModel = models?.find((model) => model.type === AIProviderModelType.TEXT)
                if (isNil(textModel)) {
                    continue
                }
                const { data: config } = await tryCatch(() => aiProviderService(log).getConfigOrThrow({ platformId, provider: provider.provider, scope, configId: key.id }))
                if (isNil(config)) {
                    continue
                }
                return {
                    model: agentAiUtils.createChatModel({
                        provider: config.provider,
                        auth: config.auth,
                        config: config.config,
                        modelId: textModel.id,
                    }),
                    failure: null,
                }
            }
        }
        return { model: null, failure: ModelResolutionFailure.NO_TEXT_MODEL }
    },
})

export type ResolvedModel = {
    model: LanguageModel | null
    failure: ModelResolutionFailure | null
}

type ResolveParams = {
    projectId: string
    platformId: string
}

type AiModelResolver = {
    resolveTextModel(params: ResolveParams): Promise<ResolvedModel>
}
