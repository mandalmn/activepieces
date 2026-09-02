import { isNil, tryCatch } from '@activepieces/core-utils';
import {
  GenerateFlowFromPromptRequest,
  GenerateFlowFromPromptResponse,
  PlanWorkflowRequest,
  PlanWorkflowResponse,
  ResolveWorkflowPlanRequest,
  ResolveWorkflowPlanResponse,
  CreateStepRunRequestBody,
  EditFlowRequest,
  EditFlowResponse,
  FlowOperationType,
  FlowRun,
  FlowStatus,
  PopulatedFlow,
  PublishGeneratedFlowRequest,
  PublishGeneratedFlowResponse,
  RepairGeneratedFlowRequest,
  RepairGeneratedFlowResponse,
  ValidateGeneratedFlowRequest,
  ValidateGeneratedFlowResponse,
} from '@activepieces/shared';
import { useMutation } from '@tanstack/react-query';

import { flowsApi } from '@/features/flows';

import { aiFlowBuilderApi } from '../api/ai-flow-builder-api';

export const aiFlowBuilderMutations = {
  usePlanWorkflow: ({
    onSuccess,
    onError,
  }: {
    onSuccess?: (response: PlanWorkflowResponse) => void;
    onError?: (error: Error) => void;
  }) =>
    useMutation({
      mutationFn: (request: PlanWorkflowRequest) =>
        aiFlowBuilderApi.plan(request),
      onSuccess,
      onError,
    }),
  useResolvePlan: ({
    onSuccess,
  }: {
    onSuccess?: (response: ResolveWorkflowPlanResponse) => void;
  }) =>
    useMutation({
      mutationFn: (request: ResolveWorkflowPlanRequest) =>
        aiFlowBuilderApi.resolve(request),
      onSuccess,
    }),
  useValidateFlow: ({
    onSuccess,
    onError,
  }: {
    onSuccess?: (
      response: ValidateGeneratedFlowResponse,
      request: ValidateGeneratedFlowRequest,
    ) => void;
    onError?: (error: Error) => void;
  }) =>
    useMutation({
      mutationFn: (request: ValidateGeneratedFlowRequest) =>
        aiFlowBuilderApi.validate(request),
      onSuccess,
      onError,
    }),
  useEditFlow: ({
    onSuccess,
    onError,
  }: {
    onSuccess?: (response: EditFlowResponse, request: EditFlowRequest) => void;
    onError?: (error: Error) => void;
  }) =>
    useMutation({
      mutationFn: (request: EditFlowRequest) => aiFlowBuilderApi.edit(request),
      onSuccess,
      onError,
    }),
  useToggleFlowStatus: ({
    onSuccess,
  }: {
    onSuccess?: (flow: PopulatedFlow) => void;
  }) =>
    useMutation({
      mutationFn: ({
        flowId,
        status,
      }: {
        flowId: string;
        status: FlowStatus;
      }) =>
        flowsApi.update(flowId, {
          type: FlowOperationType.CHANGE_STATUS,
          request: { status },
        }),
      onSuccess,
    }),
  usePublishFlow: ({
    onSuccess,
  }: {
    onSuccess?: (response: PublishGeneratedFlowResponse) => void;
  }) =>
    useMutation({
      mutationFn: (request: PublishGeneratedFlowRequest) =>
        aiFlowBuilderApi.publish(request),
      onSuccess,
    }),
  useRepairFlow: ({
    onSuccess,
  }: {
    onSuccess?: (
      response: RepairGeneratedFlowResponse,
      request: RepairGeneratedFlowRequest,
    ) => void;
  }) =>
    useMutation({
      mutationFn: (request: RepairGeneratedFlowRequest) =>
        aiFlowBuilderApi.repair(request),
      onSuccess,
    }),
  useTestGeneratedSteps: ({
    onSuccess,
  }: {
    onSuccess?: (
      results: StepTestResult[],
      variables: TestGeneratedStepsVariables,
    ) => void;
  }) =>
    useMutation({
      mutationFn: async ({ requests }: TestGeneratedStepsVariables) => {
        const results: StepTestResult[] = [];
        for (const request of requests) {
          const { data, error } = await tryCatch<FlowRun>(() =>
            aiFlowBuilderApi.testStep(request),
          );
          results.push({
            stepName: request.stepName,
            runId: data?.id ?? null,
            failed: !isNil(error),
          });
        }
        return results;
      },
      onSuccess,
    }),
  useGenerateFlow: ({
    onSuccess,
    onError,
  }: {
    onSuccess?: (response: GenerateFlowFromPromptResponse) => void;
    onError?: (error: Error) => void;
  }) =>
    useMutation({
      mutationFn: (request: GenerateFlowFromPromptRequest) =>
        aiFlowBuilderApi.generate(request),
      onSuccess,
      onError,
    }),
};

export type StepTestResult = {
  stepName: string;
  runId: string | null;
  failed: boolean;
};

export type TestGeneratedStepsVariables = {
  flowId: string;
  validation: ValidateGeneratedFlowResponse;
  requests: CreateStepRunRequestBody[];
};
