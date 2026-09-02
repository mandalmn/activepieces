import { ListActivityLogsRequest } from '@activepieces/shared';
import { useQuery } from '@tanstack/react-query';

import { activityLogApi } from '../api/activity-log-api';

export const activityLogKeys = {
  list: (request: ListActivityLogsRequest) =>
    ['activity-logs', request] as const,
};

export const activityLogQueries = {
  useActivityLogs: (request: ListActivityLogsRequest) =>
    useQuery({
      queryKey: activityLogKeys.list(request),
      queryFn: () => activityLogApi.list(request),
      meta: { showErrorDialog: true, loadSubsetOptions: {} },
    }),
};
