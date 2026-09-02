import { SeekPage } from '@activepieces/core-utils';
import {
  CreatePlatformApiKeyRequest,
  PlatformApiKey,
  PlatformApiKeyWithValue,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const apiKeyApi = {
  list() {
    return api.get<SeekPage<PlatformApiKey>>('/v1/api-keys');
  },
  delete(keyId: string) {
    return api.delete<void>(`/v1/api-keys/${keyId}`);
  },
  create(request: CreatePlatformApiKeyRequest) {
    return api.post<PlatformApiKeyWithValue>('/v1/api-keys', request);
  },
};
