import { ApId, BaseModelSchema, formErrors, Nullable } from '@activepieces/core-utils'
import { z } from 'zod'

export const PLATFORM_API_KEY_PREFIX = 'sk-'
export const PLATFORM_API_KEY_TRUNCATED_LENGTH = 8
export const MAX_PLATFORM_API_KEY_NAME_LENGTH = 60

export const PlatformApiKey = z.object({
    ...BaseModelSchema,
    platformId: ApId,
    displayName: z.string(),
    truncatedValue: z.string(),
    lastUsedAt: Nullable(z.string()),
})

export const PlatformApiKeyWithValue = PlatformApiKey.and(z.object({
    value: z.string(),
}))

export const CreatePlatformApiKeyRequest = z.object({
    displayName: z.string().trim().min(1, formErrors.required).max(MAX_PLATFORM_API_KEY_NAME_LENGTH, formErrors.platformApiKeyNameTooLong),
})

export type PlatformApiKey = z.infer<typeof PlatformApiKey>
export type PlatformApiKeyWithValue = z.infer<typeof PlatformApiKeyWithValue>
export type CreatePlatformApiKeyRequest = z.infer<typeof CreatePlatformApiKeyRequest>
