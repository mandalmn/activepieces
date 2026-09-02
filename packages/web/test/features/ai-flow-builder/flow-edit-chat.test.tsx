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
  CircleAlert: () => null,
  SendHorizontal: () => null,
}));

const editSpy = vi.fn();
vi.mock('@/features/ai-flow-builder/api/ai-flow-builder-api', () => ({
  aiFlowBuilderApi: { edit: (...args: unknown[]) => editSpy(...args) },
}));

vi.mock('@/features/flows', () => ({ flowsApi: { update: vi.fn() } }));

import { FlowEditChat } from '@/features/ai-flow-builder/components/flow-edit-chat';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function reply({
  explanation,
  readiness = 'READY',
  outcome = 'APPLIED',
  steps = [],
}: {
  explanation: string;
  readiness?: string;
  outcome?: string;
  steps?: { displayName: string; isTrigger: boolean }[];
}) {
  return {
    outcome,
    explanation,
    applied: [],
    rejected: [],
    publication: null,
    validation: {
      readiness,
      publishable: readiness === 'READY',
      flowVersionId: 'v1',
      issues: [],
      steps: steps.map((step) => ({
        stepName: step.displayName,
        displayName: step.displayName,
        pieceName: null,
        isTrigger: step.isTrigger,
        valid: true,
        testability: 'NOT_APPLICABLE',
        issues: [],
      })),
    },
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
        <FlowEditChat projectId="project-1" flowId="flow-1" />
      </QueryClientProvider>,
    );
  });
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

async function say(instruction: string) {
  const textarea = container?.querySelector('textarea');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(textarea, instruction);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    buttonByText('Apply change').click();
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  editSpy.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

describe('FlowEditChat', () => {
  it('sends the instruction against the flow being edited', async () => {
    editSpy.mockResolvedValue(reply({ explanation: 'moved it to 8 AM' }));
    setup();
    await say('Make it run at 8 AM instead.');

    expect(editSpy).toHaveBeenCalledWith({
      projectId: 'project-1',
      flowId: 'flow-1',
      instruction: 'Make it run at 8 AM instead.',
    });
  });

  it('shows the instruction and the explanation of what changed', async () => {
    editSpy.mockResolvedValue(reply({ explanation: 'moved it to 8 AM' }));
    setup();
    await say('Make it run at 8 AM instead.');

    expect(container?.textContent).toContain('Make it run at 8 AM instead.');
    expect(container?.textContent).toContain('moved it to 8 AM');
  });

  it('shows the updated flow preview and status', async () => {
    editSpy.mockResolvedValue(
      reply({
        explanation: 'added Gmail',
        steps: [
          { displayName: 'Send HTTP request', isTrigger: false },
          { displayName: 'Send Email', isTrigger: false },
        ],
      }),
    );
    setup();
    await say('Send it to Gmail too.');

    expect(container?.textContent).toContain(
      'Send HTTP request → Send Email',
    );
    expect(container?.textContent).toContain('Ready');
  });

  it('keeps every turn so the conversation reads in order', async () => {
    editSpy.mockResolvedValueOnce(reply({ explanation: 'moved it to 8 AM' }));
    editSpy.mockResolvedValueOnce(reply({ explanation: 'added Gmail' }));
    setup();
    await say('Make it run at 8 AM instead.');
    await say('Send it to Gmail too.');

    expect(editSpy).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain('moved it to 8 AM');
    expect(container?.textContent).toContain('added Gmail');
  });

  it('says plainly when nothing was changed', async () => {
    editSpy.mockResolvedValue(
      reply({
        explanation: 'That change was not clear enough',
        outcome: 'NOT_UNDERSTOOD',
        readiness: 'NEEDS_REPAIR',
      }),
    );
    setup();
    await say('What is the weather?');

    expect(container?.textContent).toContain('Nothing was changed');
    expect(container?.textContent).toContain('Needs repair');
  });

  it('does not send an empty instruction', async () => {
    setup();
    await act(async () => {
      buttonByText('Apply change').click();
      await Promise.resolve();
    });

    expect(editSpy).not.toHaveBeenCalled();
  });

  it('surfaces an error without losing the panel', async () => {
    editSpy.mockRejectedValue(new Error('boom'));
    setup();
    await say('Make it run at 8 AM instead.');

    expect(container?.textContent).toContain(
      "We couldn't apply that change. Try again.",
    );
    expect(buttonByText('Apply change')).toBeTruthy();
  });
});
