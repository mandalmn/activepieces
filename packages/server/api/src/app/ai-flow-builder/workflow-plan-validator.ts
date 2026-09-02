import { isNil } from '@activepieces/core-utils'
import { WorkflowPlan, WorkflowTriggerKind } from '@activepieces/shared'

const CRON_TERM = String.raw`(\*|\d{1,2}|[a-z]{3})(-(\d{1,2}|[a-z]{3}))?(\/\d{1,2})?`
const CRON_FIELD = new RegExp(`^${CRON_TERM}(,${CRON_TERM})*$`, 'i')

export const workflowPlanValidator = {
    validate({ plan }: { plan: WorkflowPlan }): string[] {
        return [
            ...duplicateStepIds({ plan }),
            ...unknownDependencies({ plan }),
            ...selfDependencies({ plan }),
            ...cyclicDependencies({ plan }),
            ...scheduleConsistency({ plan }),
        ]
    },
}

function duplicateStepIds({ plan }: { plan: WorkflowPlan }): string[] {
    const seen = new Set<string>()
    return plan.steps.flatMap((step) => {
        if (seen.has(step.id)) {
            return [`Duplicate step id "${step.id}"`]
        }
        seen.add(step.id)
        return []
    })
}

function unknownDependencies({ plan }: { plan: WorkflowPlan }): string[] {
    const ids = new Set(plan.steps.map((step) => step.id))
    return plan.steps.flatMap((step) => step.dependsOn
        .filter((dependency) => !ids.has(dependency))
        .map((dependency) => `Step "${step.id}" depends on unknown step "${dependency}"`))
}

function selfDependencies({ plan }: { plan: WorkflowPlan }): string[] {
    return plan.steps
        .filter((step) => step.dependsOn.includes(step.id))
        .map((step) => `Step "${step.id}" depends on itself`)
}

function cyclicDependencies({ plan }: { plan: WorkflowPlan }): string[] {
    const dependencies = new Map(plan.steps.map((step) => [step.id, step.dependsOn]))
    const settled = new Set<string>()
    const visiting = new Set<string>()
    const cycles: string[] = []

    const walk = (id: string): void => {
        if (settled.has(id)) {
            return
        }
        if (visiting.has(id)) {
            cycles.push(`Step "${id}" is part of a dependency cycle`)
            return
        }
        visiting.add(id)
        for (const dependency of dependencies.get(id) ?? []) {
            if (dependencies.has(dependency)) {
                walk(dependency)
            }
        }
        visiting.delete(id)
        settled.add(id)
    }

    for (const step of plan.steps) {
        walk(step.id)
    }
    return cycles
}

function scheduleConsistency({ plan }: { plan: WorkflowPlan }): string[] {
    const isScheduled = plan.trigger.kind === WorkflowTriggerKind.SCHEDULE
    if (isScheduled && isNil(plan.trigger.schedule)) {
        return ['A scheduled trigger must include a schedule']
    }
    if (!isScheduled && !isNil(plan.trigger.schedule)) {
        return ['Only a scheduled trigger may include a schedule']
    }
    if (isNil(plan.trigger.schedule)) {
        return []
    }
    return [
        ...invalidCron({ cronExpression: plan.trigger.schedule.cronExpression }),
        ...invalidTimezone({ timezone: plan.trigger.schedule.timezone }),
    ]
}

function invalidCron({ cronExpression }: { cronExpression: string }): string[] {
    const fields = cronExpression.trim().split(/\s+/)
    if (fields.length !== 5) {
        return [`"${cronExpression}" is not a five field cron expression`]
    }
    if (!fields.every((field) => CRON_FIELD.test(field))) {
        return [`"${cronExpression}" is not a valid cron expression`]
    }
    return []
}

function invalidTimezone({ timezone }: { timezone: string }): string[] {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return []
    }
    catch {
        return [`"${timezone}" is not a known timezone`]
    }
}
