import {
  ActivationDecision,
  AutomationLifecycle,
  GeneratedStep,
  PublishGeneratedFlowResponse,
  WorkflowPlan,
} from '@activepieces/shared';
import { t } from 'i18next';
import { ChevronRight, ListChecks, Pause, Play, Workflow } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const lifecycleLabel = (lifecycle: AutomationLifecycle): string => {
  switch (lifecycle) {
    case AutomationLifecycle.DRAFT:
      return t('Draft');
    case AutomationLifecycle.NEEDS_SETUP:
      return t('Needs setup');
    case AutomationLifecycle.READY:
      return t('Ready');
    case AutomationLifecycle.ACTIVE:
      return t('Active');
    case AutomationLifecycle.FAILED:
      return t('Failed');
  }
};

const lifecycleTone = (lifecycle: AutomationLifecycle): string => {
  switch (lifecycle) {
    case AutomationLifecycle.ACTIVE:
      return 'border-primary/40 text-primary';
    case AutomationLifecycle.READY:
      return 'border-primary/30 text-muted-foreground';
    case AutomationLifecycle.FAILED:
      return 'border-destructive/50 text-destructive';
    case AutomationLifecycle.DRAFT:
    case AutomationLifecycle.NEEDS_SETUP:
      return 'border-warning/50 text-warning';
  }
};

export const AutomationResultCard = ({
  plan,
  steps,
  publication,
  paused,
  onOpen,
  onEdit,
  onTogglePause,
}: {
  plan: WorkflowPlan;
  steps: GeneratedStep[];
  publication: PublishGeneratedFlowResponse;
  paused: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
}) => {
  const lifecycle = paused ? AutomationLifecycle.READY : publication.lifecycle;
  const chain = steps.filter((step) => step.pieceName !== null);
  const published = publication.publishedVersionId !== null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('Automation created')}</p>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        {plan.trigger.schedule && (
          <p className="text-sm text-muted-foreground">
            {plan.trigger.schedule.description} ·{' '}
            {plan.trigger.schedule.timezone}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chain.map((step, index) => (
          <span key={step.stepName} className="flex items-center gap-1.5">
            {index > 0 && (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
            <span className="text-sm">{step.displayName}</span>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('Status')}</span>
        <Badge variant="outline" className={cn(lifecycleTone(lifecycle))}>
          {lifecycleLabel(lifecycle)}
        </Badge>
      </div>

      {publication.activation.decision === ActivationDecision.NEEDS_APPROVAL &&
        publication.activation.holds.length > 0 && (
          <ul className="flex flex-col gap-1">
            {publication.activation.holds.map((hold) => (
              <li key={hold.stepName} className="text-xs text-warning">
                {hold.detail}
              </li>
            ))}
          </ul>
        )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={onOpen}>
          <Workflow className="mr-2 h-4 w-4" />
          {t('Open flow')}
        </Button>
        {published && (
          <Button type="button" variant="outline" onClick={onTogglePause}>
            {paused ? (
              <Play className="mr-2 h-4 w-4" />
            ) : (
              <Pause className="mr-2 h-4 w-4" />
            )}
            {paused ? t('Resume') : t('Pause')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onEdit}>
          <ListChecks className="mr-2 h-4 w-4" />
          {t('Edit steps')}
        </Button>
      </div>
    </div>
  );
};
