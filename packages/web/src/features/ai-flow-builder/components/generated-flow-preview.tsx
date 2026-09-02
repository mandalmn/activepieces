import {
  FlowReadiness,
  GeneratedStep,
  GeneratedStepRequirement,
  ValidateGeneratedFlowResponse,
} from '@activepieces/shared';
import { t } from 'i18next';
import {
  ArrowDown,
  Check,
  CircleAlert,
  Plug,
  TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MAX_LISTED_ISSUES = 6;

const readinessLabel = (readiness: FlowReadiness): string => {
  switch (readiness) {
    case FlowReadiness.READY:
      return t('Ready');
    case FlowReadiness.MISSING_CONNECTION:
      return t('Missing connection');
    case FlowReadiness.NEEDS_REPAIR:
      return t('Needs repair');
  }
};

const ReadinessBadge = ({ readiness }: { readiness: FlowReadiness }) => (
  <Badge
    variant="outline"
    className={cn(
      readiness === FlowReadiness.READY
        ? 'border-primary/40 text-primary'
        : 'border-warning/50 text-warning',
    )}
  >
    {readinessLabel(readiness)}
  </Badge>
);

const ValidationSummary = ({
  validation,
}: {
  validation: ValidateGeneratedFlowResponse;
}) => {
  if (validation.issues.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1">
      {validation.issues.slice(0, MAX_LISTED_ISSUES).map((issue, index) => (
        <li
          key={`${issue.rule}-${issue.stepName}-${issue.propertyName}-${index}`}
          className="text-xs text-muted-foreground"
        >
          {issue.detail}
        </li>
      ))}
    </ul>
  );
};

const requirementLabel = (requirement: GeneratedStepRequirement): string => {
  switch (requirement) {
    case GeneratedStepRequirement.CONNECTION_MISSING:
      return t('Connect this app');
    case GeneratedStepRequirement.CONNECTION_CHOICE:
      return t('Choose an account');
    case GeneratedStepRequirement.REQUIRED_INPUT:
      return t('Fill the required fields');
    case GeneratedStepRequirement.INPUT_NEEDS_BUILDER:
      return t('Pick the remaining options');
    case GeneratedStepRequirement.NO_TOOL_RESOLVED:
      return t('No matching app was found');
  }
};

export const GeneratedFlowPreview = ({
  flowName,
  steps,
  validation,
}: {
  flowName: string;
  steps: GeneratedStep[];
  validation?: ValidateGeneratedFlowResponse | null;
}) => {
  const outstanding = steps.filter((step) => step.requirements.length > 0);
  const readiness = validation?.readiness ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{flowName}</h2>
          {readiness !== null && <ReadinessBadge readiness={readiness} />}
        </div>
        <p className="text-sm text-muted-foreground">
          {outstanding.length === 0 && readiness === FlowReadiness.READY
            ? t('Every step is configured. Open it to review and publish.')
            : t(
                'Built as a draft. Finish the highlighted steps before it runs.',
              )}
        </p>
        {validation !== null && validation !== undefined && (
          <ValidationSummary validation={validation} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <div key={step.stepName} className="flex flex-col gap-2">
            {index > 0 && (
              <ArrowDown className="size-4 self-center text-muted-foreground" />
            )}
            <div
              className={cn(
                'rounded-md border p-3',
                step.requirements.length === 0
                  ? 'border-border'
                  : 'border-warning/50 bg-warning/5',
              )}
            >
              <div className="flex items-center gap-2">
                {step.requirements.length === 0 ? (
                  <Check className="size-4 text-muted-foreground" />
                ) : (
                  <CircleAlert className="size-4 text-warning" />
                )}
                <span className="text-sm font-medium">{step.displayName}</span>
                {step.pieceName === null && (
                  <Badge variant="outline">{t('No step added')}</Badge>
                )}
              </div>

              {step.connectionDisplayName && (
                <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  <Plug className="size-3" />
                  {t('Using {account}', {
                    account: step.connectionDisplayName,
                  })}
                </p>
              )}

              {step.requirements.map((requirement) => (
                <p
                  key={requirement}
                  className="flex items-center gap-1.5 pt-1 text-xs font-medium text-warning"
                >
                  <TriangleAlert className="size-3" />
                  {requirementLabel(requirement)}
                </p>
              ))}

              {step.missingProperties.length > 0 && (
                <p className="pt-1 text-xs text-muted-foreground">
                  {step.missingProperties.join(', ')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
