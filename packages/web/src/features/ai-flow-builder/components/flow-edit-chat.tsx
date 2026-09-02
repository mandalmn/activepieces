import {
  EditFlowResponse,
  FlowEditOutcome,
  FlowReadiness,
  MAX_EDIT_INSTRUCTION_LENGTH,
  formErrors,
} from '@activepieces/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from 'i18next';
import { CircleAlert, SendHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { aiFlowBuilderMutations } from '../hooks/ai-flow-builder-hooks';

const EditFormSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1, formErrors.required)
    .max(MAX_EDIT_INSTRUCTION_LENGTH, formErrors.aiFlowPromptTooLong),
});

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

export const FlowEditChat = ({
  projectId,
  flowId,
  onEdited,
}: {
  projectId: string;
  flowId: string;
  onEdited?: (response: EditFlowResponse) => void;
}) => {
  const [turns, setTurns] = useState<EditTurn[]>([]);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(EditFormSchema),
    defaultValues: { instruction: '' },
    mode: 'onChange',
  });

  const editFlow = aiFlowBuilderMutations.useEditFlow({
    onSuccess: (response, request) => {
      setTurns((previous) => [
        ...previous,
        { instruction: request.instruction, response },
      ]);
      form.reset({ instruction: '' });
      onEdited?.(response);
    },
    onError: () => {
      form.setError('root.serverError', {
        type: 'manual',
        message: t("We couldn't apply that change. Try again."),
      });
    },
  });

  const handleSubmit = ({ instruction }: EditFormValues) => {
    form.clearErrors('root.serverError');
    editFlow.mutate({ projectId, flowId, instruction });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-sm font-medium">{t('Change this automation')}</p>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {turns.map((turn, index) => (
          <div
            key={`${index}-${turn.instruction}`}
            className="flex flex-col gap-1.5"
          >
            <p className="self-end rounded-md bg-accent px-3 py-1.5 text-sm">
              {turn.instruction}
            </p>
            <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
              <p className="text-sm">{turn.response.explanation}</p>
              <StepChain response={turn.response} />
              <div className="flex items-center gap-2 pt-1">
                <Badge
                  variant="outline"
                  className={cn(
                    turn.response.validation.readiness === FlowReadiness.READY
                      ? 'border-primary/40 text-primary'
                      : 'border-warning/50 text-warning',
                  )}
                >
                  {readinessLabel(turn.response.validation.readiness)}
                </Badge>
                {turn.response.outcome !== FlowEditOutcome.APPLIED && (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <CircleAlert className="size-3" />
                    {t('Nothing was changed')}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col gap-2"
        >
          <FormField
            control={form.control}
            name="instruction"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea
                    {...field}
                    minRows={2}
                    maxRows={6}
                    disabled={editFlow.isPending}
                    placeholder={t('Make it run at 8 AM instead.')}
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
          <Button
            type="submit"
            className="self-end"
            loading={editFlow.isPending}
          >
            <SendHorizontal className="mr-2 h-4 w-4" />
            {t('Apply change')}
          </Button>
        </form>
      </Form>
    </div>
  );
};

const StepChain = ({ response }: { response: EditFlowResponse }) => {
  const steps = response.validation.steps.filter((step) => !step.isTrigger);
  if (steps.length === 0) {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground">
      {steps.map((step) => step.displayName).join(' → ')}
    </p>
  );
};

type EditTurn = {
  instruction: string;
  response: EditFlowResponse;
};

type EditFormValues = z.infer<typeof EditFormSchema>;
