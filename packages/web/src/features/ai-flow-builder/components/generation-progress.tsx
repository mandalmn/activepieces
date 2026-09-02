import { t } from 'i18next';
import { Check, CircleAlert, Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

export const GenerationProgress = ({
  stages,
}: {
  stages: GenerationStage[];
}) => (
  <ol className="flex flex-col gap-1.5">
    {stages.map((stage) => (
      <li key={stage.label} className="flex items-center gap-2 text-sm">
        <StageIcon state={stage.state} />
        <span
          className={cn(
            stage.state === GenerationStageState.PENDING &&
              'text-muted-foreground',
            stage.state === GenerationStageState.FAILED &&
              'font-medium text-destructive',
            stage.state === GenerationStageState.ATTENTION &&
              'font-medium text-warning',
          )}
        >
          {stage.label}
          {stage.state === GenerationStageState.RUNNING ? '…' : ''}
        </span>
      </li>
    ))}
  </ol>
);

const StageIcon = ({ state }: { state: GenerationStageState }) => {
  switch (state) {
    case GenerationStageState.DONE:
      return <Check className="size-4 text-muted-foreground" />;
    case GenerationStageState.RUNNING:
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
    case GenerationStageState.FAILED:
      return <CircleAlert className="size-4 text-destructive" />;
    case GenerationStageState.ATTENTION:
      return <TriangleAlert className="size-4 text-warning" />;
    case GenerationStageState.PENDING:
      return <span className="size-4 rounded-full border border-border" />;
  }
};

export const generationStages = {
  labels: () => ({
    planning: t('Planning'),
    tools: t('Finding tools'),
    accounts: t('Connecting accounts'),
    building: t('Generating flow'),
    validating: t('Validating'),
    repairing: t('Repairing'),
    testing: t('Testing'),
  }),
};

export enum GenerationStageState {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  ATTENTION = 'ATTENTION',
  FAILED = 'FAILED',
}

export type GenerationStage = {
  label: string;
  state: GenerationStageState;
};
