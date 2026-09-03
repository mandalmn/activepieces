import { isNil, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import {
    MAX_WORKFLOW_PLAN_STEPS,
    PlanWorkflowResponse,
    WORKFLOW_PLAN_VERSION,
    WorkflowPlan,
    WorkflowPlanStatus,
    WorkflowStepKind,
    WorkflowTriggerKind,
} from '@activepieces/shared'
import { generateText } from 'ai'
import { FastifyBaseLogger } from 'fastify'
import { aiModelResolver, ModelResolutionFailure } from './ai-model-resolver'
import { workflowPlanValidator } from './workflow-plan-validator'

const PLAN_TIMEOUT_MS = 30_000
const DEFAULT_TIMEZONE = 'UTC'

export const workflowPlannerService = (log: FastifyBaseLogger): WorkflowPlannerService => ({
    async plan({ projectId, platformId, prompt, timezone }: PlanParams): Promise<PlanWorkflowResponse> {
        const resolved = await aiModelResolver(log).resolveTextModel({ projectId, platformId })
        if (isNil(resolved.model)) {
            return unavailable({ prompt, failure: resolved.failure })
        }

        const zone = usableTimezone({ timezone })
        const { data: reply, error } = await tryCatch(() => withTimeout({
            promise: generateText({
                model: resolved.model!,
                system: buildPlannerPrompt({ timezone: zone }),
                prompt,
            }),
            ms: PLAN_TIMEOUT_MS,
        }))
        if (!isNil(error) || isNil(reply)) {
            log.warn({ error, projectId }, '[workflowPlanner#plan] Planner call failed')
            return { status: WorkflowPlanStatus.FAILED, prompt, plan: null, issues: ['The planner could not be reached'] }
        }

        const { data: parsed, error: parseError } = tryCatchSync(() => JSON.parse(stripFences({ text: reply.text })))
        if (!isNil(parseError) || isNil(parsed)) {
            log.warn({ projectId }, '[workflowPlanner#plan] Planner returned unparseable output')
            return { status: WorkflowPlanStatus.FAILED, prompt, plan: null, issues: ['The planner returned something that was not a workflow plan'] }
        }

        const decoded = WorkflowPlan.safeParse(parsed)
        if (!decoded.success) {
            const issues = decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            log.warn({ projectId, issues }, '[workflowPlanner#plan] Planner output failed schema validation')
            return { status: WorkflowPlanStatus.FAILED, prompt, plan: null, issues }
        }

        const issues = workflowPlanValidator.validate({ plan: decoded.data })
        if (issues.length > 0) {
            log.warn({ projectId, issues }, '[workflowPlanner#plan] Planner output failed semantic validation')
            return { status: WorkflowPlanStatus.FAILED, prompt, plan: null, issues }
        }

        return { status: WorkflowPlanStatus.PLANNED, prompt, plan: decoded.data, issues: [] }
    },
})

function unavailable({ prompt, failure }: { prompt: string, failure: ModelResolutionFailure | null }): PlanWorkflowResponse {
    const issue = failure === ModelResolutionFailure.NO_TEXT_MODEL
        ? 'The configured AI provider exposes no text model'
        : 'No AI provider is configured for this project'
    return { status: WorkflowPlanStatus.UNAVAILABLE, prompt, plan: null, issues: [issue] }
}

function usableTimezone({ timezone }: { timezone: string | undefined }): string {
    if (isNil(timezone)) {
        return DEFAULT_TIMEZONE
    }
    const { error } = tryCatchSync(() => new Intl.DateTimeFormat('en-US', { timeZone: timezone }))
    return isNil(error) ? timezone : DEFAULT_TIMEZONE
}

function stripFences({ text }: { text: string }): string {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
    return (fenced?.[1] ?? text).trim()
}

function buildPlannerPrompt({ timezone }: { timezone: string }): string {
    return [
        'You turn an automation request into a workflow plan.',
        'You describe WHAT the automation must do. Keep every summary about the work rather than the tool, and never name an integration, connector or API endpoint. The one place a product belongs is the "product" field, and only when the person named it themselves.',
        'Answer with a single JSON object and nothing else. No prose, no code fences.',
        '',
        'Shape:',
        '{',
        `  "version": ${WORKFLOW_PLAN_VERSION},`,
        '  "name": "short title, max 60 characters",',
        '  "description": "one sentence describing the automation",',
        '  "trigger": {',
        `    "kind": "${WorkflowTriggerKind.SCHEDULE}" | "${WorkflowTriggerKind.EVENT}" | "${WorkflowTriggerKind.MANUAL}",`,
        '    "summary": "what starts the automation",',
        '    "service": "the kind of system that emits the event, or null",',
        '    "product": "the product the person named for this, or null",',
        '    "schedule": { "cronExpression": "five field cron", "timezone": "IANA zone", "description": "plain words" } or null',
        '  },',
        '  "steps": [',
        '    {',
        '      "id": "lowercase_snake_case identifier",',
        `      "kind": "${WorkflowStepKind.FETCH}" | "${WorkflowStepKind.TRANSFORM}" | "${WorkflowStepKind.OUTPUT}" | "${WorkflowStepKind.CONDITION}",`,
        '      "summary": "what this step does, in plain words",',
        '      "service": "the kind of system involved, or null",',
        '      "product": "the product the person named for this step, or null",',
        '      "dependsOn": ["ids of steps that must run first"]',
        '    }',
        '  ]',
        '}',
        '',
        'Rules:',
        `- Use timezone "${timezone}" for schedules unless the request names a different one.`,
        '- "schedule" must be present when kind is SCHEDULE, and null otherwise.',
        '- The first step has an empty dependsOn. Every other step depends on at least one earlier step.',
        '- Split the work: retrieving data, transforming or calculating it, and delivering it are separate steps.',
        `- At most ${MAX_WORKFLOW_PLAN_STEPS} steps.`,
        '- "service" is a category such as "email", "chat", "spreadsheet" or "market data" — never a product name.',
        '- "product" is the product the person actually named for that step, such as "salesforce", "gmail" or "slack". Use null when they named none. Always fill "service" as well, so the step still works when that product is not connected.',
        '- Keep every "service" value in English. Write "name", "description" and every "summary" in the language the request is written in.',
    ].join('\n')
}

async function withTimeout<T>({ promise, ms }: { promise: Promise<T>, ms: number }): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Planner timed out after ${ms}ms`)), ms)
    })
    try {
        return await Promise.race([promise, expiry])
    }
    finally {
        if (!isNil(timer)) {
            clearTimeout(timer)
        }
    }
}

type PlanParams = {
    projectId: string
    platformId: string
    prompt: string
    timezone: string | undefined
}

type WorkflowPlannerService = {
    plan(params: PlanParams): Promise<PlanWorkflowResponse>
}
