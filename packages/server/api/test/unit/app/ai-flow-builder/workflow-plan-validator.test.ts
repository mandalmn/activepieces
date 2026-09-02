import { WORKFLOW_PLAN_VERSION, WorkflowPlan, WorkflowStepKind, WorkflowTriggerKind } from '@activepieces/shared'
import { workflowPlanValidator } from '../../../../src/app/ai-flow-builder/workflow-plan-validator'

function planOf(overrides: Partial<WorkflowPlan> = {}): WorkflowPlan {
    return {
        version: WORKFLOW_PLAN_VERSION,
        name: 'Daily gold price',
        description: 'Sends yesterday gold price change',
        trigger: {
            kind: WorkflowTriggerKind.SCHEDULE,
            summary: 'Every day at 07:00',
            service: null,
            schedule: { cronExpression: '0 7 * * *', timezone: 'Asia/Ulaanbaatar', description: 'every day at 07:00' },
        },
        steps: [
            { id: 'fetch_price', kind: WorkflowStepKind.FETCH, summary: 'Get yesterday price', service: 'market data', dependsOn: [] },
            { id: 'compute_change', kind: WorkflowStepKind.TRANSFORM, summary: 'Percentage change', service: null, dependsOn: ['fetch_price'] },
            { id: 'send_message', kind: WorkflowStepKind.OUTPUT, summary: 'Send the result', service: 'chat', dependsOn: ['compute_change'] },
        ],
        ...overrides,
    }
}

describe('workflowPlanValidator', () => {
    it('accepts a well formed sequential plan', () => {
        expect(workflowPlanValidator.validate({ plan: planOf() })).toEqual([])
    })

    it('rejects duplicate step ids', () => {
        const plan = planOf({
            steps: [
                { id: 'a', kind: WorkflowStepKind.FETCH, summary: 'one', service: null, dependsOn: [] },
                { id: 'a', kind: WorkflowStepKind.OUTPUT, summary: 'two', service: null, dependsOn: [] },
            ],
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('Duplicate step id "a"')
    })

    it('rejects a dependency on a step that does not exist', () => {
        const plan = planOf({
            steps: [
                { id: 'a', kind: WorkflowStepKind.FETCH, summary: 'one', service: null, dependsOn: [] },
                { id: 'b', kind: WorkflowStepKind.OUTPUT, summary: 'two', service: null, dependsOn: ['ghost'] },
            ],
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('Step "b" depends on unknown step "ghost"')
    })

    it('rejects a step that depends on itself', () => {
        const plan = planOf({
            steps: [{ id: 'a', kind: WorkflowStepKind.FETCH, summary: 'one', service: null, dependsOn: ['a'] }],
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('Step "a" depends on itself')
    })

    it('rejects a dependency cycle', () => {
        const plan = planOf({
            steps: [
                { id: 'a', kind: WorkflowStepKind.FETCH, summary: 'one', service: null, dependsOn: ['b'] },
                { id: 'b', kind: WorkflowStepKind.TRANSFORM, summary: 'two', service: null, dependsOn: ['a'] },
            ],
        })
        expect(workflowPlanValidator.validate({ plan }).some((issue) => issue.includes('dependency cycle'))).toBe(true)
    })

    it('requires a schedule on a scheduled trigger', () => {
        const plan = planOf({
            trigger: { kind: WorkflowTriggerKind.SCHEDULE, summary: 'Daily', service: null, schedule: null },
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('A scheduled trigger must include a schedule')
    })

    it('refuses a schedule on a non scheduled trigger', () => {
        const plan = planOf({
            trigger: {
                kind: WorkflowTriggerKind.EVENT,
                summary: 'When mail arrives',
                service: 'email',
                schedule: { cronExpression: '0 7 * * *', timezone: 'UTC', description: 'daily' },
            },
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('Only a scheduled trigger may include a schedule')
    })

    it('rejects a malformed cron expression', () => {
        const plan = planOf({
            trigger: {
                kind: WorkflowTriggerKind.SCHEDULE,
                summary: 'Daily',
                service: null,
                schedule: { cronExpression: '0 7 * *', timezone: 'UTC', description: 'daily' },
            },
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('"0 7 * *" is not a five field cron expression')
    })

    it('rejects five words that are not a cron expression', () => {
        const plan = planOf({
            trigger: {
                kind: WorkflowTriggerKind.SCHEDULE,
                summary: 'Daily',
                service: null,
                schedule: { cronExpression: 'whenever I feel like it', timezone: 'UTC', description: 'daily' },
            },
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('"whenever I feel like it" is not a valid cron expression')
    })

    it.each(['0 7 * * *', '*/15 * * * *', '0 9 1,15 * *', '30 6 * * mon-fri', '0 0 1 JAN *'])('accepts the cron expression %s', (cronExpression) => {
        const plan = planOf({
            trigger: {
                kind: WorkflowTriggerKind.SCHEDULE,
                summary: 'Scheduled',
                service: null,
                schedule: { cronExpression, timezone: 'UTC', description: 'scheduled' },
            },
        })
        expect(workflowPlanValidator.validate({ plan })).toEqual([])
    })

    it('rejects an unknown timezone', () => {
        const plan = planOf({
            trigger: {
                kind: WorkflowTriggerKind.SCHEDULE,
                summary: 'Daily',
                service: null,
                schedule: { cronExpression: '0 7 * * *', timezone: 'Mars/Olympus', description: 'daily' },
            },
        })
        expect(workflowPlanValidator.validate({ plan })).toContain('"Mars/Olympus" is not a known timezone')
    })

    it('accepts an event trigger with no schedule', () => {
        const plan = planOf({
            trigger: { kind: WorkflowTriggerKind.EVENT, summary: 'When mail arrives', service: 'email', schedule: null },
        })
        expect(workflowPlanValidator.validate({ plan })).toEqual([])
    })

    it('accepts a step that fans in from two earlier steps', () => {
        const plan = planOf({
            steps: [
                { id: 'a', kind: WorkflowStepKind.FETCH, summary: 'today', service: null, dependsOn: [] },
                { id: 'b', kind: WorkflowStepKind.FETCH, summary: 'yesterday', service: null, dependsOn: [] },
                { id: 'c', kind: WorkflowStepKind.TRANSFORM, summary: 'compare', service: null, dependsOn: ['a', 'b'] },
            ],
        })
        expect(workflowPlanValidator.validate({ plan })).toEqual([])
    })
})
