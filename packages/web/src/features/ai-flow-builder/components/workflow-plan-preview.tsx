import {
  ResolvedWorkflowPlan,
  WorkflowPlan,
  WorkflowStepKind,
  WorkflowTriggerKind,
} from '@activepieces/shared';
import { t } from 'i18next';
import { ArrowDown, CalendarClock, Radio, Hand } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import { ConnectionRequirement } from './connection-requirement';

const triggerIcon = (kind: WorkflowTriggerKind) => {
  switch (kind) {
    case WorkflowTriggerKind.SCHEDULE:
      return CalendarClock;
    case WorkflowTriggerKind.EVENT:
      return Radio;
    case WorkflowTriggerKind.MANUAL:
      return Hand;
  }
};

const stepKindLabel = (kind: WorkflowStepKind): string => {
  switch (kind) {
    case WorkflowStepKind.FETCH:
      return t('Retrieve');
    case WorkflowStepKind.TRANSFORM:
      return t('Calculate');
    case WorkflowStepKind.OUTPUT:
      return t('Deliver');
    case WorkflowStepKind.CONDITION:
      return t('Check');
  }
};

export const WorkflowPlanPreview = ({
  plan,
  resolved,
}: {
  plan: WorkflowPlan;
  resolved?: ResolvedWorkflowPlan | null;
}) => {
  const TriggerIcon = triggerIcon(plan.trigger.kind);
  const toolByStepId = new Map(
    (resolved?.steps ?? []).map((step) => [step.id, step.tool]),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{plan.name}</h2>
        {plan.description.length > 0 && (
          <p className="text-sm text-muted-foreground">{plan.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <TriggerIcon className="size-4 text-muted-foreground" />
            <Badge variant="outline">{t('Trigger')}</Badge>
            <span className="text-sm font-medium">{plan.trigger.summary}</span>
          </div>
          {plan.trigger.schedule && (
            <p className="pt-1 text-xs text-muted-foreground">
              {plan.trigger.schedule.description} ·{' '}
              {plan.trigger.schedule.cronExpression} ·{' '}
              {plan.trigger.schedule.timezone}
            </p>
          )}
          {resolved?.trigger.tool && (
            <ConnectionRequirement
              connection={resolved.trigger.tool.connection}
              pieceDisplayName={resolved.trigger.tool.pieceDisplayName}
            />
          )}
        </div>

        {plan.steps.map((step) => {
          const tool = toolByStepId.get(step.id);
          return (
            <div key={step.id} className="flex flex-col gap-2">
              <ArrowDown className="size-4 self-center text-muted-foreground" />
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{stepKindLabel(step.kind)}</Badge>
                  <span className="text-sm font-medium">{step.summary}</span>
                </div>
                {tool ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    {tool.pieceDisplayName} · {tool.objectDisplayName}
                  </p>
                ) : (
                  step.service && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {step.service}
                    </p>
                  )
                )}
                {tool && (
                  <ConnectionRequirement
                    connection={tool.connection}
                    pieceDisplayName={tool.pieceDisplayName}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
