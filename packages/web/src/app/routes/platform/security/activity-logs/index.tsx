import { ActivityLog } from '@activepieces/shared';
import { t } from 'i18next';
import { useState } from 'react';

import { CenteredPage } from '@/app/components/centered-page';
import { CollapsibleJson } from '@/components/custom/collapsible-json';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { activityLogQueries } from '@/features/platform-admin';
import { formatUtils } from '@/lib/format-utils';

const PAGE_SIZE = 25;

export default function ActivityLogsPage() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);

  const { data, isLoading } = activityLogQueries.useActivityLogs({
    limit: PAGE_SIZE,
    cursor,
  });

  const rows: ActivityLog[] = data?.data ?? [];
  const nextCursor = data?.next ?? null;

  return (
    <CenteredPage
      title={t('Audit Logs')}
      description={t('Every action taken across this platform, newest first.')}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Action')}</TableHead>
            <TableHead>{t('User')}</TableHead>
            <TableHead>{t('Project')}</TableHead>
            <TableHead>{t('When')}</TableHead>
            <TableHead>{t('Details')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading &&
            [0, 1, 2, 3, 4].map((index) => (
              <TableRow key={index}>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))}
          {!isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                {t('Nothing has happened yet.')}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.action}</TableCell>
              <TableCell>{row.userEmail ?? t('System')}</TableCell>
              <TableCell>{row.projectDisplayName ?? '-'}</TableCell>
              <TableCell className="whitespace-nowrap">
                {formatUtils.formatDateToAgo(new Date(row.created))}
              </TableCell>
              <TableCell className="max-w-[360px]">
                <CollapsibleJson json={row.data} label={t('Data')} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-end gap-2 pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={previousCursors.length === 0}
          onClick={() => {
            const previous = [...previousCursors];
            const target = previous.pop();
            setPreviousCursors(previous);
            setCursor(target);
          }}
        >
          {t('Previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={nextCursor === null}
          onClick={() => {
            if (nextCursor === null) {
              return;
            }
            setPreviousCursors((previous) => [...previous, cursor ?? '']);
            setCursor(nextCursor);
          }}
        >
          {t('Next')}
        </Button>
      </div>
    </CenteredPage>
  );
}
