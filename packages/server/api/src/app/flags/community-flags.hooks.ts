import { isNil } from '@activepieces/core-utils'
import { ApFlagId, PrincipalType } from '@activepieces/shared'
import { platformService } from '../platform/platform.service'
import { platformUtils } from '../platform/platform.utils'
import { FlagsServiceHooks } from './flags.hooks'
import { generateTheme } from './theme'

export const communityFlagsHooks: FlagsServiceHooks = {
    async modify({ flags, request }) {
        const platformId = await platformIdFor({ request })
        if (isNil(platformId)) {
            return flags
        }
        const platform = await platformService(request.log).getOneOrThrow(platformId)
        return {
            ...flags,
            [ApFlagId.THEME]: generateTheme({
                websiteName: platform.name,
                fullLogoUrl: platform.fullLogoUrl,
                favIconUrl: platform.favIconUrl,
                logoIconUrl: platform.logoIconUrl,
                primaryColor: platform.primaryColor,
                themeColors: platform.themeColors ?? undefined,
            }),
        }
    },
}

function platformIdFor({ request }: { request: Parameters<FlagsServiceHooks['modify']>[0]['request'] }): Promise<string | null> | string {
    const principal = request.principal
    const unusable = isNil(principal)
        || principal.type === PrincipalType.UNKNOWN
        || principal.type === PrincipalType.WORKER
        || principal.type === PrincipalType.ONBOARDING
    return unusable ? platformUtils.getPlatformIdForRequest(request) : principal.platform.id
}
