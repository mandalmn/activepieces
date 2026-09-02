import { isNil } from '@activepieces/core-utils';
import {
  AiFlowActionSkipReason,
  AI_FLOW_PROMPT_MAX_LENGTH,
  UncategorizedFolderId,
  FlowReadiness,
  FlowStatus,
  GeneratedStep,
  PublishGeneratedFlowResponse,
  RepairOutcome,
  RepairGeneratedFlowResponse,
  StepTestability,
  ResolvedWorkflowPlan,
  ValidateGeneratedFlowResponse,
  WorkflowPlan,
  WorkflowPlanStatus,
  formErrors,
} from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from 'i18next';
import { Info, Sparkles, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { flowHooks } from '@/features/flows';
import { projectCollectionUtils } from '@/features/projects';
import { api } from '@/lib/api';
import { NEW_FLOW_QUERY_PARAM } from '@/lib/route-utils';

import {
  aiFlowBuilderMutations,
  StepTestResult,
} from '../hooks/ai-flow-builder-hooks';

import { AutomationResultCard } from './automation-result-card';
import { GeneratedFlowPreview } from './generated-flow-preview';
import {
  GenerationProgress,
  GenerationStage,
  GenerationStageState,
  generationStages,
} from './generation-progress';
import { WorkflowPlanPreview } from './workflow-plan-preview';

const AiPromptFormSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, formErrors.required)
    .max(AI_FLOW_PROMPT_MAX_LENGTH, formErrors.aiFlowPromptTooLong),
});

const actionSkipMessage = (reason: AiFlowActionSkipReason): string => {
  switch (reason) {
    case AiFlowActionSkipReason.NO_AI_PROVIDER:
      return t(
        'Drafted the schedule only. Connect an AI provider under Platform Admin to have steps suggested.',
      );
    case AiFlowActionSkipReason.NO_TEXT_MODEL:
      return t(
        'Drafted the schedule only. Your AI provider has no usable text model selected.',
      );
    case AiFlowActionSkipReason.NO_MATCHING_ACTION:
      return t(
        'Drafted the schedule only. No matching step was found for your description.',
      );
    case AiFlowActionSkipReason.SUGGESTION_FAILED:
      return t('Drafted the schedule only. Suggesting a step failed.');
  }
};

const stageState = ({
  running,
  done,
}: {
  running: boolean;
  done: boolean;
}): GenerationStageState => {
  if (running) {
    return GenerationStageState.RUNNING;
  }
  return done ? GenerationStageState.DONE : GenerationStageState.PENDING;
};

const progressStages = ({
  planning,
  resolving,
  building,
  validating,
  hasPlan,
  hasResolved,
  hasFlow,
  validation,
  testing,
  tested,
  repairing,
  repaired,
}: ProgressInput): GenerationStage[] => {
  const labels = generationStages.labels();
  return [
    {
      label: labels.planning,
      state: stageState({ running: planning, done: hasPlan }),
    },
    {
      label: labels.tools,
      state: stageState({ running: resolving, done: hasResolved }),
    },
    {
      label: labels.accounts,
      state: stageState({ running: resolving, done: hasResolved }),
    },
    {
      label: labels.building,
      state: stageState({ running: building, done: hasFlow }),
    },
    {
      label: labels.validating,
      state: validating
        ? GenerationStageState.RUNNING
        : validation === null
        ? GenerationStageState.PENDING
        : validation.readiness === FlowReadiness.READY
        ? GenerationStageState.DONE
        : GenerationStageState.ATTENTION,
    },
    ...(repairing || repaired !== null
      ? [
          {
            label: labels.repairing,
            state: repairing
              ? GenerationStageState.RUNNING
              : repaired?.outcome === RepairOutcome.REPAIRED
              ? GenerationStageState.DONE
              : GenerationStageState.ATTENTION,
          },
        ]
      : []),
    {
      label: labels.testing,
      state: testing
        ? GenerationStageState.RUNNING
        : tested === null
        ? GenerationStageState.PENDING
        : tested.some((result) => result.failed)
        ? GenerationStageState.ATTENTION
        : GenerationStageState.DONE,
    },
  ];
};

const promptExamples = [
  'Every day at 9 AM, email me the insurance policies expiring in the next 30 days.',
  "Every Monday at 8 AM, send the team a summary of last week's new claims.",
  'Every day at 6 PM, send a renewal reminder to customers whose policy expires this week.',
];

export const AiPromptBuilder = () => {
  const navigate = useNavigate();
  const { project } = projectCollectionUtils.useCurrentProject();
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [resolved, setResolved] = useState<ResolvedWorkflowPlan | null>(null);
  const [generated, setGenerated] = useState<GeneratedStep[] | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [validation, setValidation] =
    useState<ValidateGeneratedFlowResponse | null>(null);
  const [tested, setTested] = useState<StepTestResult[] | null>(null);
  const [repaired, setRepaired] = useState<RepairGeneratedFlowResponse | null>(
    null,
  );
  const [publication, setPublication] =
    useState<PublishGeneratedFlowResponse | null>(null);
  const [paused, setPaused] = useState(false);
  const startFromScratch = flowHooks.useStartFromScratch(UncategorizedFolderId);

  const form = useForm<AiPromptFormValues>({
    resolver: zodResolver(AiPromptFormSchema),
    defaultValues: { prompt: '' },
    mode: 'onChange',
  });

  const resolvePlan = aiFlowBuilderMutations.useResolvePlan({
    onSuccess: (response) => setResolved(response.plan ?? null),
  });

  const publishFlow = aiFlowBuilderMutations.usePublishFlow({
    onSuccess: (response) => {
      setPublication(response);
      setPaused(response.status === FlowStatus.DISABLED);
    },
  });

  const toggleStatus = aiFlowBuilderMutations.useToggleFlowStatus({
    onSuccess: (flow) => setPaused(flow.status === FlowStatus.DISABLED),
  });

  const testSteps = aiFlowBuilderMutations.useTestGeneratedSteps({
    onSuccess: (results, variables) => {
      setTested(results);
      publishIfReady({
        flowId: variables.flowId,
        validation: variables.validation,
      });
    },
  });

  const repairFlow = aiFlowBuilderMutations.useRepairFlow({
    onSuccess: (response, request) => {
      setRepaired(response);
      setValidation(response.validation);
      runTests({ validation: response.validation, flowId: request.flowId });
    },
  });

  const validateFlow = aiFlowBuilderMutations.useValidateFlow({
    onSuccess: (response, request) => {
      setValidation(response);
      if (
        response.readiness === FlowReadiness.NEEDS_REPAIR &&
        repaired === null
      ) {
        repairFlow.mutate({
          projectId: project.id,
          flowId: request.flowId,
          prompt: form.getValues('prompt'),
          plan,
        });
        return;
      }
      runTests({ validation: response, flowId: request.flowId });
    },
  });

  const runTests = ({
    validation: report,
    flowId: targetFlowId,
  }: {
    validation: ValidateGeneratedFlowResponse;
    flowId: string;
  }) => {
    const testable = report.steps.filter(
      (step) => step.testability === StepTestability.TESTABLE,
    );
    if (testable.length === 0) {
      setTested([]);
      publishIfReady({ flowId: targetFlowId, validation: report });
      return;
    }
    testSteps.mutate({
      flowId: targetFlowId,
      validation: report,
      requests: testable.map((step) => ({
        projectId: project.id,
        flowVersionId: report.flowVersionId,
        stepName: step.stepName,
      })),
    });
  };

  const publishIfReady = ({
    flowId: targetFlowId,
    validation: report,
  }: {
    flowId: string;
    validation: ValidateGeneratedFlowResponse;
  }) => {
    if (report.readiness !== FlowReadiness.READY) {
      return;
    }
    publishFlow.mutate({ projectId: project.id, flowId: targetFlowId });
  };

  const planWorkflow = aiFlowBuilderMutations.usePlanWorkflow({
    onSuccess: (response) => {
      if (response.status === WorkflowPlanStatus.PLANNED && response.plan) {
        setPlan(response.plan);
        resolvePlan.mutate({ projectId: project.id, plan: response.plan });
        return;
      }
      setNotice(
        response.issues[0] ??
          t('The planner could not interpret that request.'),
      );
    },
    onError: (error) => {
      form.setError('root.serverError', {
        type: 'manual',
        message: api.extractServerErrorMessage(
          error,
          t("We couldn't interpret your automation. Try again."),
        ),
      });
    },
  });

  const generateFlow = aiFlowBuilderMutations.useGenerateFlow({
    onSuccess: (response) => {
      if (!isNil(response.flowId)) {
        if (!isNil(response.actionSkipReason)) {
          toast.info(actionSkipMessage(response.actionSkipReason));
        }
        setFlowId(response.flowId);
        if (response.steps.length > 0) {
          setGenerated(response.steps);
          validateFlow.mutate({
            projectId: project.id,
            flowId: response.flowId,
          });
          return;
        }
        navigate(`/flows/${response.flowId}?${NEW_FLOW_QUERY_PARAM}=true`);
        return;
      }
      setNotice(
        t(
          'Tell me when this should run, for example "every day at 7 AM", and I will draft it.',
        ),
      );
    },
    onError: (error) => {
      form.setError('root.serverError', {
        type: 'manual',
        message: api.extractServerErrorMessage(
          error,
          t("We couldn't generate your automation. Try again."),
        ),
      });
    },
  });

  const handleSubmit = ({ prompt }: AiPromptFormValues) => {
    form.clearErrors('root.serverError');
    setNotice(null);
    setPlan(null);
    setResolved(null);
    setGenerated(null);
    setFlowId(null);
    setValidation(null);
    setTested(null);
    setRepaired(null);
    setPublication(null);
    setPaused(false);
    planWorkflow.mutate({
      projectId: project.id,
      prompt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };

  const busy =
    planWorkflow.isPending ||
    resolvePlan.isPending ||
    generateFlow.isPending ||
    validateFlow.isPending ||
    repairFlow.isPending ||
    testSteps.isPending ||
    publishFlow.isPending ||
    startFromScratch.isPending;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('What do you want to automate?')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('Describe it in plain language and we will draft the automation.')}
        </p>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="prompt"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    {...field}
                    autoFocus
                    minRows={4}
                    maxRows={12}
                    disabled={busy}
                    placeholder={t(
                      'Every day at 9 AM, email me the insurance policies expiring in the next 30 days.',
                    )}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.formState.errors.root?.serverError && (
            <p className="text-sm text-destructive">
              {form.formState.errors.root.serverError.message}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              loading={startFromScratch.isPending}
              disabled={generateFlow.isPending}
              onClick={() => startFromScratch.mutate()}
            >
              <Workflow className="mr-2 h-4 w-4" />
              {t('Open the visual builder')}
            </Button>
            <Button
              type="submit"
              loading={planWorkflow.isPending}
              disabled={busy && !planWorkflow.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t('Generate automation')}
            </Button>
          </div>
        </form>
      </Form>

      {busy && (
        <div className="rounded-lg border border-border p-4">
          <GenerationProgress
            stages={progressStages({
              planning: planWorkflow.isPending,
              resolving: resolvePlan.isPending,
              building: generateFlow.isPending,
              validating: validateFlow.isPending,
              hasPlan: !isNil(plan),
              hasResolved: !isNil(resolved),
              hasFlow: !isNil(generated),
              validation,
              testing: testSteps.isPending,
              tested,
              repairing: repairFlow.isPending,
              repaired,
            })}
          />
        </div>
      )}

      {publication && plan && generated && !busy && (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <AutomationResultCard
            plan={plan}
            steps={generated}
            publication={publication}
            paused={paused}
            onOpen={() =>
              navigate(
                `/flows/${publication.flowId}?${NEW_FLOW_QUERY_PARAM}=true`,
              )
            }
            onEdit={() => navigate(`/flows/${publication.flowId}`)}
            onTogglePause={() =>
              toggleStatus.mutate({
                flowId: publication.flowId,
                status: paused ? FlowStatus.ENABLED : FlowStatus.DISABLED,
              })
            }
          />
        </div>
      )}

      {generated && plan && !publication && !busy && (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <GeneratedFlowPreview
            flowName={plan.name}
            steps={generated}
            validation={validation}
          />
          <div className="flex items-center justify-end">
            <Button
              type="button"
              onClick={() =>
                navigate(`/flows/${flowId}?${NEW_FLOW_QUERY_PARAM}=true`)
              }
            >
              <Workflow className="mr-2 h-4 w-4" />
              {t('Open in builder')}
            </Button>
          </div>
        </div>
      )}

      {plan && !generated && (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <WorkflowPlanPreview plan={plan} resolved={resolved} />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPlan(null);
                setResolved(null);
              }}
            >
              {t('Discard')}
            </Button>
            <Button
              type="button"
              loading={generateFlow.isPending}
              disabled={startFromScratch.isPending}
              onClick={() =>
                generateFlow.mutate({
                  projectId: project.id,
                  prompt: form.getValues('prompt'),
                  plan,
                })
              }
            >
              <Workflow className="mr-2 h-4 w-4" />
              {t('Build the automation')}
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <Alert variant="primary">
          <Info className="h-4 w-4" />
          <AlertTitle>{t('Add a schedule')}</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t('Try one of these')}
        </p>
        <div className="flex flex-col gap-2">
          {promptExamples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() =>
                form.setValue('prompt', example, {
                  shouldValidate: true,
                })
              }
              className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {t(example)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

type ProgressInput = {
  planning: boolean;
  resolving: boolean;
  building: boolean;
  validating: boolean;
  hasPlan: boolean;
  hasResolved: boolean;
  hasFlow: boolean;
  validation: ValidateGeneratedFlowResponse | null;
  testing: boolean;
  tested: StepTestResult[] | null;
  repairing: boolean;
  repaired: RepairGeneratedFlowResponse | null;
};

type AiPromptFormValues = z.infer<typeof AiPromptFormSchema>;
