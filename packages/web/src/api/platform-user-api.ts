import { SeekPage } from '@activepieces/core-utils';
import {
  UpdateUserRequestBody,
  User,
  UserWithMetaInformation,
  ListUsersRequestBody,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const platformUserApi = {
  list(request: ListUsersRequestBody) {
    return api.get<SeekPage<UserWithMetaInformation>>('/v1/users', request);
  },
  delete(id: string) {
    return api.delete(`/v1/users/${id}`);
  },
  transferOwnership(platformId: string, newOwnerId: string): Promise<void> {
    return api.post<void>(`/v1/platforms/${platformId}/transfer-ownership`, {
      newOwnerId,
    });
  },
  update(id: string, request: UpdateUserRequestBody): Promise<User> {
    return api.post<User>(`/v1/users/${id}`, request);
  },
};
