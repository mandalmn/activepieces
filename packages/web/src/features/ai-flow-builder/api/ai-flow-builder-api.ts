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
  FlowRun,
  PublishGeneratedFlowRequest,
  PublishGeneratedFlowResponse,
  RepairGeneratedFlowRequest,
  RepairGeneratedFlowResponse,
  ValidateGeneratedFlowRequest,
  ValidateGeneratedFlowResponse,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const aiFlowBuilderApi = {
  plan(request: PlanWorkflowRequest): Promise<PlanWorkflowResponse> {
    return api.post<PlanWorkflowResponse>('/v1/ai-flow-builder/plan', request);
  },
  resolve(
    request: ResolveWorkflowPlanRequest,
  ): Promise<ResolveWorkflowPlanResponse> {
    return api.post<ResolveWorkflowPlanResponse>(
      '/v1/ai-flow-builder/resolve',
      request,
    );
  },
  validate(
    request: ValidateGeneratedFlowRequest,
  ): Promise<ValidateGeneratedFlowResponse> {
    return api.post<ValidateGeneratedFlowResponse>(
      '/v1/ai-flow-builder/validate',
      request,
    );
  },
  edit(request: EditFlowRequest): Promise<EditFlowResponse> {
    return api.post<EditFlowResponse>('/v1/ai-flow-builder/edit', request);
  },
  publish(
    request: PublishGeneratedFlowRequest,
  ): Promise<PublishGeneratedFlowResponse> {
    return api.post<PublishGeneratedFlowResponse>(
      '/v1/ai-flow-builder/publish',
      request,
    );
  },
  repair(
    request: RepairGeneratedFlowRequest,
  ): Promise<RepairGeneratedFlowResponse> {
    return api.post<RepairGeneratedFlowResponse>(
      '/v1/ai-flow-builder/repair',
      request,
    );
  },
  testStep(request: CreateStepRunRequestBody): Promise<FlowRun> {
    return api.post<FlowRun>('/v1/sample-data/test-step', request);
  },
  generate(
    request: GenerateFlowFromPromptRequest,
  ): Promise<GenerateFlowFromPromptResponse> {
    return api.post<GenerateFlowFromPromptResponse>(
      '/v1/ai-flow-builder/generate',
      request,
    );
  },
};
