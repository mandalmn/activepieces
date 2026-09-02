import {
  ConnectionBindingStatus,
  ResolvedConnection,
} from '@activepieces/shared';
import { t } from 'i18next';
import { CircleAlert, Plug, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

export const ConnectionRequirement = ({
  connection,
  pieceDisplayName,
}: {
  connection: ResolvedConnection;
  pieceDisplayName: string;
}) => {
  if (connection.status === ConnectionBindingStatus.NOT_REQUIRED) {
    return null;
  }

  if (connection.status === ConnectionBindingStatus.BOUND) {
    return (
      <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
        <Plug className="size-3" />
        {t('Using {account}', { account: connection.displayName ?? '' })}
      </p>
    );
  }

  const missing = connection.status === ConnectionBindingStatus.MISSING;
  const Icon = missing ? TriangleAlert : CircleAlert;

  return (
    <p
      className={cn(
        'flex items-center gap-1.5 pt-1 text-xs font-medium',
        missing ? 'text-destructive' : 'text-warning',
      )}
    >
      <Icon className="size-3" />
      {missing
        ? t('Connect {app} before this runs', { app: pieceDisplayName })
        : t('Choose which {app} account to use', { app: pieceDisplayName })}
    </p>
  );
};
