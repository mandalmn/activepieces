import { SeekPage } from '@activepieces/core-utils';
import { ActivityLog, ListActivityLogsRequest } from '@activepieces/shared';

import { api } from '@/lib/api';

export const activityLogApi = {
  list(request: ListActivityLogsRequest) {
    return api.get<SeekPage<ActivityLog>>('/v1/activity-logs', request);
  },
};
