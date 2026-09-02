/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({ t: (key: string) => key }));

vi.mock('lucide-react', () => ({
  ArrowDown: () => null,
  Check: () => null,
  CircleAlert: () => null,
  ChevronRight: () => null,
  ListChecks: () => null,
  Loader2: () => null,
  Pause: () => null,
  Play: () => null,
  Plug: () => null,
  TriangleAlert: () => null,
  CalendarClock: () => null,
  Hand: () => null,
  Info: () => null,
  Radio: () => null,
  Sparkles: () => null,
  Workflow: () => null,
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
}));

const toastInfoSpy = vi.fn();
vi.mock('sonner', () => ({ toast: { info: (...a: unknown[]) => toastInfoSpy(...a) } }));

const startFromScratchSpy = vi.fn();
const updateFlowSpy = vi.fn();
vi.mock('@/features/flows', () => ({
  flowsApi: { update: (...a: unknown[]) => updateFlowSpy(...a) },
  flowHooks: {
    useStartFromScratch: () => ({
      mutate: startFromScratchSpy,
      isPending: false,
    }),
  },
}));

vi.mock('@/features/projects', () => ({
  projectCollectionUtils: {
    useCurrentProject: () => ({ project: { id: 'project-1' } }),
  },
}));

const planSpy = vi.fn();
const resolveSpy = vi.fn();
const generateSpy = vi.fn();
const validateSpy = vi.fn();
const testStepSpy = vi.fn();
const repairSpy = vi.fn();
const publishSpy = vi.fn();
vi.mock('@/features/ai-flow-builder/api/ai-flow-builder-api', () => ({
  aiFlowBuilderApi: {
    plan: (...args: unknown[]) => planSpy(...args),
    resolve: (...args: unknown[]) => resolveSpy(...args),
    generate: (...args: unknown[]) => generateSpy(...args),
    validate: (...args: unknown[]) => validateSpy(...args),
    testStep: (...args: unknown[]) => testStepSpy(...args),
    repair: (...args: unknown[]) => repairSpy(...args),
    publish: (...args: unknown[]) => publishSpy(...args),
  },
}));

import { AiPromptBuilder } from '@/features/ai-flow-builder/components/ai-prompt-builder';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const plannedResponse = {
  status: 'PLANNED',
  prompt: 'anything',
  issues: [],
  plan: {
    version: 1,
    name: 'Daily gold price',
    description: 'Sends the daily change',
    trigger: {
      kind: 'SCHEDULE',
      summary: 'Every day at 07:00',
      service: null,
      schedule: {
        cronExpression: '0 7 * * *',
        timezone: 'Asia/Ulaanbaatar',
        description: 'every day at 07:00',
      },
    },
    steps: [
      { id: 'fetch_price', kind: 'FETCH', summary: 'Fetch yesterday price', service: 'market data', dependsOn: [] },
      { id: 'compute_change', kind: 'TRANSFORM', summary: 'Compute change', service: null, dependsOn: ['fetch_price'] },
      { id: 'deliver', kind: 'OUTPUT', summary: 'Send to chat', service: 'chat', dependsOn: ['compute_change'] },
    ],
  },
};

const mongolianPrompt =
  'би өглөө болгон 7 цагт sukhtumur@mandal.mn руу сайн уу гэж явуулмаар байна';

function resolvedWith({
  connection,
}: {
  connection: Record<string, unknown>;
}) {
  return {
    status: 'RESOLVED',
    issues: [],
    plan: {
      version: 1,
      name: 'Daily gold price',
      description: 'Sends the daily change',
      trigger: {
        kind: 'SCHEDULE',
        summary: 'Every day at 07:00',
        schedule: null,
        status: 'RESOLVED',
        confidence: 'EXACT',
        tool: null,
        reason: null,
      },
      steps: [
        {
          id: 'deliver',
          kind: 'OUTPUT',
          summary: 'Send to chat',
          service: 'chat',
          dependsOn: [],
          status: 'RESOLVED',
          confidence: 'HIGH',
          reason: null,
          tool: {
            kind: 'ACTION',
            pieceName: '@activepieces/piece-telegram-bot',
            pieceVersion: '1.0.0',
            pieceDisplayName: 'Telegram Bot',
            objectName: 'send_text_message',
            objectDisplayName: 'Send Text Message',
            requiresConnection: true,
            requiredProperties: [],
            connection,
          },
        },
      ],
      unresolvedStepIds: [],
    },
  };
}

function generatedResponse() {
  return {
    status: 'DRAFTED',
    prompt: 'anything',
    flowId: 'flow-123',
    schedule: null,
    suggestedAction: null,
    actionSkipReason: null,
    steps: [
      {
        stepName: 'step_1',
        planStepId: 'notify',
        displayName: 'Send Text Message',
        pieceName: '@activepieces/piece-telegram-bot',
        actionName: 'send_text_message',
        valid: true,
        connectionDisplayName: 'Telegram Personal',
        requirements: [],
        missingProperties: [],
      },
    ],
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function setup() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const newRoot = createRoot(container);
  root = newRoot;
  act(() => {
    newRoot.render(
      <QueryClientProvider client={new QueryClient()}>
        <AiPromptBuilder />
      </QueryClientProvider>,
    );
  });
}

function promptTextarea(): HTMLTextAreaElement {
  const textarea = container?.querySelector('textarea');
  if (!textarea) {
    throw new Error('prompt textarea not found');
  }
  return textarea;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`button not found: ${text}`);
  }
  return button;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function submitPrompt(value: string) {
  const textarea = promptTextarea();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    buttonByText('Generate automation').click();
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  resolveSpy.mockReset();
  resolveSpy.mockResolvedValue({ status: 'RESOLVED', plan: null, issues: [] });
  testStepSpy.mockReset();
  testStepSpy.mockResolvedValue({ id: 'run-1' });
  updateFlowSpy.mockReset();
  updateFlowSpy.mockResolvedValue({ id: 'flow-123', status: 'DISABLED' });
  publishSpy.mockReset();
  publishSpy.mockResolvedValue({
    lifecycle: 'ACTIVE',
    activation: { decision: 'AUTOMATIC', holds: [] },
    flowId: 'flow-123',
    publishedVersionId: 'v1',
    status: 'ENABLED',
    validation: {
      readiness: 'READY',
      publishable: true,
      flowVersionId: 'v1',
      steps: [],
      issues: [],
    },
  });
  repairSpy.mockReset();
  repairSpy.mockResolvedValue({
    outcome: 'REPAIRED',
    attempts: [],
    unrepairableRules: [],
    validation: {
      readiness: 'READY',
      publishable: true,
      flowVersionId: 'v1',
      steps: [],
      issues: [],
    },
  });
  validateSpy.mockReset();
  validateSpy.mockResolvedValue({
    readiness: 'READY',
    publishable: true,
    flowVersionId: 'v1',
    steps: [],
    issues: [],
  });
  navigateSpy.mockReset();
  startFromScratchSpy.mockReset();
  planSpy.mockReset();
  generateSpy.mockReset();
  toastInfoSpy.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

describe('AiPromptBuilder', () => {
  it('renders the prompt-first entry point', () => {
    setup();
    expect(container?.textContent).toContain('What do you want to automate?');
    expect(promptTextarea()).toBeTruthy();
    expect(buttonByText('Generate automation')).toBeTruthy();
    expect(buttonByText('Open the visual builder')).toBeTruthy();
  });

  it('asks the planner for a plan, with the browser timezone', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    setup();
    await submitPrompt('send me gold prices');

    expect(planSpy).toHaveBeenCalledTimes(1);
    const request = planSpy.mock.calls[0][0];
    expect(request.projectId).toBe('project-1');
    expect(request.prompt).toBe('send me gold prices');
    expect(typeof request.timezone).toBe('string');
    expect(generateSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('renders the interpreted plan as a preview', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain('Daily gold price');
    expect(container?.textContent).toContain('Every day at 07:00');
    expect(container?.textContent).toContain('Fetch yesterday price');
    expect(container?.textContent).toContain('Compute change');
    expect(container?.textContent).toContain('Send to chat');
    expect(container?.textContent).toContain('0 7 * * *');
    expect(container?.textContent).toContain('Asia/Ulaanbaatar');
  });

  it('only builds the flow once the plan is accepted', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue({
      status: 'DRAFTED',
      prompt: 'anything',
      flowId: 'flow-123',
      schedule: null,
      suggestedAction: null,
      actionSkipReason: null,
      steps: [],
    });
    setup();
    await submitPrompt('anything');

    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/flows/flow-123?newFlow=true');
  });

  it('hands the interpreted plan to the builder instead of the raw prompt', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue({
      status: 'DRAFTED',
      prompt: mongolianPrompt,
      flowId: 'flow-123',
      schedule: null,
      suggestedAction: null,
      actionSkipReason: null,
      steps: [],
    });
    setup();
    await submitPrompt(mongolianPrompt);

    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    const request = generateSpy.mock.calls[0][0];
    expect(request.prompt).toBe(mongolianPrompt);
    expect(request.plan).toEqual(plannedResponse.plan);
  });

  it('discards the plan without building anything', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    setup();
    await submitPrompt('anything');

    await act(async () => {
      buttonByText('Discard').click();
      await Promise.resolve();
    });
    await settle();

    expect(container?.textContent).not.toContain('Fetch yesterday price');
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('surfaces the planner issue when no plan comes back', async () => {
    planSpy.mockResolvedValue({
      status: 'UNAVAILABLE',
      prompt: 'anything',
      plan: null,
      issues: ['No AI provider is configured for this project'],
    });
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain(
      'No AI provider is configured for this project',
    );
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('surfaces the reason the planner request failed', async () => {
    planSpy.mockRejectedValue(new Error('the model is not reachable'));
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain('the model is not reachable');
  });

  it('falls back to a readable message when the failure carries none', async () => {
    planSpy.mockRejectedValue(new Error(''));
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain(
      "We couldn't interpret your automation. Try again.",
    );
  });

  it('asks the resolver which pieces the plan needs', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    setup();
    await submitPrompt('anything');

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy.mock.calls[0][0]).toMatchObject({
      projectId: 'project-1',
      plan: plannedResponse.plan,
    });
  });

  it('names the account a step will use once it is bound', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    resolveSpy.mockResolvedValue(
      resolvedWith({
        connection: {
          status: 'BOUND',
          reason: 'ONLY_ACCOUNT_CONNECTED',
          externalId: 'conn_telegram',
          displayName: 'Telegram Personal',
          options: [],
        },
      }),
    );
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain('Telegram Bot');
    expect(container?.textContent).toContain('Using {account}');
  });

  it('warns when a step has no connection to use', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    resolveSpy.mockResolvedValue(
      resolvedWith({
        connection: {
          status: 'MISSING',
          reason: 'NO_ACCOUNT_CONNECTED',
          externalId: null,
          displayName: null,
          options: [],
        },
      }),
    );
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain('Connect {app} before this runs');
  });

  it('asks the user to choose when several accounts fit', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    resolveSpy.mockResolvedValue(
      resolvedWith({
        connection: {
          status: 'NEEDS_SELECTION',
          reason: 'SEVERAL_ACCOUNTS_MATCH',
          externalId: null,
          displayName: null,
          options: [
            { externalId: 'a', displayName: 'Telegram Personal' },
            { externalId: 'b', displayName: 'Telegram Work' },
          ],
        },
      }),
    );
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain(
      'Choose which {app} account to use',
    );
  });

  it('still shows the plan when the resolver is unavailable', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    resolveSpy.mockRejectedValue(new Error('boom'));
    setup();
    await submitPrompt('anything');

    expect(container?.textContent).toContain('Fetch yesterday price');
    expect(buttonByText('Build the automation')).toBeTruthy();
  });

  it('shows the built flow with its outstanding work instead of leaving the page', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    validateSpy.mockResolvedValue({
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [],
    });
    repairSpy.mockResolvedValue({
      outcome: 'UNCHANGED',
      attempts: [],
      unrepairableRules: [],
      validation: {
        readiness: 'NEEDS_REPAIR',
        publishable: false,
        flowVersionId: 'v1',
        steps: [],
        issues: [],
      },
    });

    generateSpy.mockResolvedValue({
      status: 'DRAFTED',
      prompt: 'anything',
      flowId: 'flow-123',
      schedule: null,
      suggestedAction: null,
      actionSkipReason: null,
      steps: [
        {
          stepName: 'step_1',
          planStepId: 'fetch_price',
          displayName: 'Send HTTP request',
          pieceName: '@activepieces/piece-http',
          actionName: 'send_request',
          valid: false,
          connectionDisplayName: null,
          requirements: ['REQUIRED_INPUT'],
          missingProperties: ['url'],
        },
        {
          stepName: 'step_2',
          planStepId: 'notify',
          displayName: 'Send Text Message',
          pieceName: '@activepieces/piece-telegram-bot',
          actionName: 'send_text_message',
          valid: false,
          connectionDisplayName: 'Telegram Personal',
          requirements: [],
          missingProperties: [],
        },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('Send Text Message');
    expect(container?.textContent).toContain('Using {account}');
    expect(container?.textContent).toContain('Fill the required fields');
    expect(container?.textContent).toContain('url');
  });

  it('opens the canvas from the generated flow preview', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    validateSpy.mockResolvedValue({
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [],
    });
    repairSpy.mockResolvedValue({
      outcome: 'UNCHANGED',
      attempts: [],
      unrepairableRules: [],
      validation: {
        readiness: 'NEEDS_REPAIR',
        publishable: false,
        flowVersionId: 'v1',
        steps: [],
        issues: [],
      },
    });

    generateSpy.mockResolvedValue({
      status: 'DRAFTED',
      prompt: 'anything',
      flowId: 'flow-123',
      schedule: null,
      suggestedAction: null,
      actionSkipReason: null,
      steps: [
        {
          stepName: 'step_1',
          planStepId: 'notify',
          displayName: 'Send Text Message',
          pieceName: '@activepieces/piece-telegram-bot',
          actionName: 'send_text_message',
          valid: true,
          connectionDisplayName: 'Telegram Personal',
          requirements: [],
          missingProperties: [],
        },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    await act(async () => {
      buttonByText('Open in builder').click();
      await Promise.resolve();
    });
    await settle();

    expect(navigateSpy).toHaveBeenCalledWith('/flows/flow-123?newFlow=true');
  });

  it('validates the flow it just built', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(validateSpy).toHaveBeenCalledWith({
      projectId: 'project-1',
      flowId: 'flow-123',
    });
  });

  it('says a connection is missing when that is what validation found', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    validateSpy.mockResolvedValue({
      readiness: 'MISSING_CONNECTION',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [
        {
          rule: 'CONNECTION_MISSING',
          severity: 'ERROR',
          stepName: 'step_1',
          propertyName: 'auth',
          detail: 'Telegram Bot needs a connected account',
        },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(container?.textContent).toContain('Missing connection');
    expect(container?.textContent).toContain(
      'Telegram Bot needs a connected account',
    );
  });

  it('says the flow needs repair when repair could not fix it', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    const stillBroken = {
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [
        {
          rule: 'REQUIRED_PROPERTY_MISSING',
          severity: 'ERROR',
          stepName: 'step_1',
          propertyName: 'chat_id',
          detail: 'Send Text Message needs chat_id',
        },
      ],
    };
    validateSpy.mockResolvedValue(stillBroken);
    repairSpy.mockResolvedValue({
      outcome: 'UNCHANGED',
      attempts: [],
      unrepairableRules: [],
      validation: stillBroken,
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(container?.textContent).toContain('Needs repair');
    expect(container?.textContent).toContain('Send Text Message needs chat_id');
  });

  it('tests only the steps validation marked safe to test', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    validateSpy.mockResolvedValue({
      readiness: 'READY',
      publishable: true,
      flowVersionId: 'version-9',
      issues: [],
      steps: [
        { stepName: 'trigger', displayName: 'Cron', pieceName: null, isTrigger: true, valid: true, testability: 'NOT_APPLICABLE', issues: [] },
        { stepName: 'step_1', displayName: 'Find Rows', pieceName: 'sheets', isTrigger: false, valid: true, testability: 'TESTABLE', issues: [] },
        { stepName: 'step_2', displayName: 'Send Message', pieceName: 'telegram', isTrigger: false, valid: true, testability: 'UNSAFE_TO_AUTO_TEST', issues: [] },
        { stepName: 'step_3', displayName: 'Add Row', pieceName: 'excel', isTrigger: false, valid: false, testability: 'NOT_CONFIGURED', issues: [] },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(testStepSpy).toHaveBeenCalledTimes(1);
    expect(testStepSpy).toHaveBeenCalledWith({
      projectId: 'project-1',
      flowVersionId: 'version-9',
      stepName: 'step_1',
    });
  });

  it('runs no test at all when nothing is safely testable', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    validateSpy.mockResolvedValue({
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'version-9',
      issues: [],
      steps: [
        { stepName: 'step_1', displayName: 'Send Message', pieceName: 'telegram', isTrigger: false, valid: true, testability: 'UNSAFE_TO_AUTO_TEST', issues: [] },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(testStepSpy).not.toHaveBeenCalled();
  });

  it('repairs the flow when validation is not ready, then publishes it', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    validateSpy.mockResolvedValue({
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [
        {
          rule: 'REQUIRED_PROPERTY_MISSING',
          severity: 'ERROR',
          stepName: 'step_1',
          propertyName: 'chat_id',
          detail: 'Send Text Message needs chat_id',
        },
      ],
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(repairSpy).toHaveBeenCalledTimes(1);
    expect(repairSpy.mock.calls[0][0]).toMatchObject({
      projectId: 'project-1',
      flowId: 'flow-123',
    });
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('Active');
  });

  it('does not repair a flow that already validated cleanly', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(repairSpy).not.toHaveBeenCalled();
  });

  it('stops after one repair round instead of looping', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    const stillBroken = {
      readiness: 'NEEDS_REPAIR',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [
        {
          rule: 'REQUIRED_PROPERTY_MISSING',
          severity: 'ERROR',
          stepName: 'step_1',
          propertyName: 'chat_id',
          detail: 'Send Text Message needs chat_id',
        },
      ],
    };
    validateSpy.mockResolvedValue(stillBroken);
    repairSpy.mockResolvedValue({
      outcome: 'UNCHANGED',
      attempts: [],
      unrepairableRules: [],
      validation: stillBroken,
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(repairSpy).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('Needs repair');
  });

  it('publishes a validated flow and shows it as active', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(publishSpy).toHaveBeenCalledWith({
      projectId: 'project-1',
      flowId: 'flow-123',
    });
    expect(container?.textContent).toContain('Automation created');
    expect(container?.textContent).toContain('Active');
    expect(buttonByText('Open flow')).toBeTruthy();
    expect(buttonByText('Pause')).toBeTruthy();
    expect(buttonByText('Edit steps')).toBeTruthy();
  });

  it('does not publish a flow that still needs setup', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    const broken = {
      readiness: 'MISSING_CONNECTION',
      publishable: false,
      flowVersionId: 'v1',
      steps: [],
      issues: [
        {
          rule: 'CONNECTION_MISSING',
          severity: 'ERROR',
          stepName: 'step_1',
          propertyName: 'auth',
          detail: 'Telegram Bot needs a connected account',
        },
      ],
    };
    validateSpy.mockResolvedValue(broken);
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(publishSpy).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('Missing connection');
  });

  it('shows an approval hold instead of activating a risky automation', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    publishSpy.mockResolvedValue({
      lifecycle: 'READY',
      activation: {
        decision: 'NEEDS_APPROVAL',
        holds: [
          {
            stepName: 'step_1',
            hold: 'DESTRUCTIVE_ACTION',
            detail: 'Google Drive: Trash File can delete or overwrite data',
          },
        ],
      },
      flowId: 'flow-123',
      publishedVersionId: 'v1',
      status: 'DISABLED',
      validation: {
        readiness: 'READY',
        publishable: true,
        flowVersionId: 'v1',
        steps: [],
        issues: [],
      },
    });
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    expect(container?.textContent).toContain('Ready');
    expect(container?.textContent).toContain(
      'Google Drive: Trash File can delete or overwrite data',
    );
    expect(buttonByText('Resume')).toBeTruthy();
  });

  it('pauses a published automation through the ordinary status operation', async () => {
    planSpy.mockResolvedValue(plannedResponse);
    generateSpy.mockResolvedValue(generatedResponse());
    setup();
    await submitPrompt('anything');
    await act(async () => {
      buttonByText('Build the automation').click();
      await Promise.resolve();
    });
    await settle();

    await act(async () => {
      buttonByText('Pause').click();
      await Promise.resolve();
    });
    await settle();

    expect(updateFlowSpy).toHaveBeenCalledWith('flow-123', {
      type: 'CHANGE_STATUS',
      request: { status: 'DISABLED' },
    });
  });

  it('does not submit an empty prompt', async () => {
    setup();
    await act(async () => {
      buttonByText('Generate automation').click();
      await Promise.resolve();
    });
    expect(planSpy).not.toHaveBeenCalled();
  });
});
