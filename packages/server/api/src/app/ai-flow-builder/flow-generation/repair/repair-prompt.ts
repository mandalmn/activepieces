import { isNil } from '@activepieces/core-utils'
import { PieceMetadataModel, PieceProperty, PropertyType } from '@activepieces/pieces-framework'
import {
    FlowValidationIssue,
    FlowValidationRule,
    FlowValidationSeverity,
    RepairOperation,
    Step,
    ValidateGeneratedFlowResponse,
    WorkflowPlan,
} from '@activepieces/shared'

const REDACTED = '<a connected account>'
const CREDENTIAL_MARKER = /\{\{\s*connections\s*\[[^\]]*\]\s*\}\}/g
const MAX_OPTIONS_LISTED = 12

export const repairPrompt = {
    build({ validation, steps, pieces, prompt, plan, unrepairable }: BuildParams): string | null {
        const repairable = validation.issues.filter((issue) =>
            issue.severity === FlowValidationSeverity.ERROR && !unrepairable.has(issue.rule) && !isNil(issue.stepName))
        if (repairable.length === 0) {
            return null
        }

        const blocks = [...new Set(repairable.map((issue) => issue.stepName ?? ''))]
            .flatMap((stepName) => describeStep({ stepName, issues: repairable, steps, pieces }))

        return [
            'You repair the configuration of steps in an automation that a colleague already built.',
            'You never rebuild the automation and you never add or remove steps.',
            '',
            'You may answer with these operations only:',
            `- ${RepairOperation.SET_PROPERTY}: set one property of one step to a value.`,
            `- ${RepairOperation.CLEAR_PROPERTY}: remove one property of one step.`,
            `- ${RepairOperation.REPLACE_ACTION}: switch a step to a different action on the SAME app.`,
            '',
            'Rules:',
            '- Only use property names listed under that step. A name that is not listed will be thrown away.',
            '- Refer to an earlier step output as {{stepName[\'output\'].field}}. The trigger is {{trigger[\'output\'].field}}.',
            '- Never write a connection or a credential into a value. Accounts are managed elsewhere.',
            '- Change as little as possible. Leave anything you cannot justify from the information below.',
            '- A value you cannot know (an account id, a spreadsheet id, a chat id) must be left alone, not invented.',
            '',
            `What the person asked for: ${prompt}`,
            ...planBlock({ plan }),
            '',
            'Steps that need attention:',
            ...blocks,
        ].join('\n')
    },

    instruction(): string {
        return 'Answer with a JSON array of operations and nothing else. Answer with [] when nothing can be fixed from this information.'
    },
}

function planBlock({ plan }: { plan: WorkflowPlan | null | undefined }): string[] {
    if (isNil(plan)) {
        return []
    }
    return [
        `The automation was planned as: ${plan.name}`,
        ...plan.steps.map((step) => `- ${step.id}: ${step.summary}`),
    ]
}

function describeStep({ stepName, issues, steps, pieces }: DescribeParams): string[] {
    const step = steps.find((candidate) => candidate.name === stepName)
    if (isNil(step)) {
        return []
    }
    const piece = pieces.get(String(step.settings.pieceName ?? ''))
    const action = piece?.actions[String(step.settings.actionName ?? '')]
    if (isNil(piece) || isNil(action)) {
        return []
    }

    const stepIssues = issues.filter((issue) => issue.stepName === stepName)
    return [
        '',
        `Step ${step.name} — ${piece.displayName}: ${action.displayName}`,
        `  Problems: ${stepIssues.map(describeIssue).join('; ')}`,
        '  Properties this action accepts:',
        ...Object.entries(action.props)
            .filter(([, property]) => property.type !== PropertyType.MARKDOWN)
            .map(([name, property]) => `    ${name} (${property.type}${property.required ? ', required' : ''})${optionsOf({ property })}${descriptionOf({ property })}`),
        `  Other actions on ${piece.displayName}: ${Object.values(piece.actions).map((candidate) => candidate.name).join(', ')}`,
        `  Current configuration: ${JSON.stringify(safeInput({ step }))}`,
        `  Earlier steps you may reference: ${earlierNames({ steps, stepName }).join(', ') || 'none'}`,
    ]
}

function describeIssue(issue: FlowValidationIssue): string {
    const property = isNil(issue.propertyName) ? '' : ` [${issue.propertyName}]`
    return `${ruleLabel({ rule: issue.rule })}${property} — ${issue.detail}`
}

function ruleLabel({ rule }: { rule: FlowValidationRule }): string {
    switch (rule) {
        case FlowValidationRule.REQUIRED_PROPERTY_MISSING:
            return 'a required property is empty'
        case FlowValidationRule.UNKNOWN_PROPERTY:
            return 'a value was put under a property that does not exist'
        case FlowValidationRule.MALFORMED_EXPRESSION:
            return 'an expression is not written correctly'
        case FlowValidationRule.UNKNOWN_STEP_REFERENCE:
            return 'an expression points at a step that is not in this automation'
        case FlowValidationRule.FORWARD_STEP_REFERENCE:
            return 'an expression points at a step that runs later'
        case FlowValidationRule.UNKNOWN_OUTPUT_FIELD:
            return 'an expression asks for a field the earlier step does not produce'
        case FlowValidationRule.COMPONENT_NOT_FOUND:
            return 'this action does not exist on the app'
        default:
            return 'a problem'
    }
}

function optionsOf({ property }: { property: PieceProperty }): string {
    if (property.type !== PropertyType.STATIC_DROPDOWN && property.type !== PropertyType.STATIC_MULTI_SELECT_DROPDOWN) {
        return ''
    }
    const options = property.options.options
    if (options.length === 0) {
        return ''
    }
    return ` — one of: ${options.slice(0, MAX_OPTIONS_LISTED).map((option) => JSON.stringify(option.value)).join(', ')}`
}

function descriptionOf({ property }: { property: PieceProperty }): string {
    return isNil(property.description) || property.description === '' ? '' : ` — ${property.description}`
}

function earlierNames({ steps, stepName }: { steps: Step[], stepName: string | null }): string[] {
    const index = steps.findIndex((candidate) => candidate.name === stepName)
    return index <= 0 ? [] : steps.slice(0, index).map((candidate) => candidate.name)
}

function safeInput({ step }: { step: Step }): Record<string, unknown> {
    const input = 'input' in step.settings && typeof step.settings.input === 'object' && !isNil(step.settings.input)
        ? step.settings.input
        : {}
    return Object.fromEntries(Object.entries(input)
        .filter(([key]) => key !== 'auth')
        .map(([key, value]) => [key, redact({ value })]))
}

function redact({ value }: { value: unknown }): unknown {
    if (typeof value === 'string') {
        return value.replace(CREDENTIAL_MARKER, REDACTED)
    }
    if (Array.isArray(value)) {
        return value.map((entry) => redact({ value: entry }))
    }
    if (typeof value === 'object' && !isNil(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact({ value: entry })]))
    }
    return value
}

type DescribeParams = {
    stepName: string
    issues: FlowValidationIssue[]
    steps: Step[]
    pieces: Map<string, PieceMetadataModel | null>
}

type BuildParams = {
    validation: ValidateGeneratedFlowResponse
    steps: Step[]
    pieces: Map<string, PieceMetadataModel | null>
    prompt: string
    plan: WorkflowPlan | null | undefined
    unrepairable: ReadonlySet<FlowValidationRule>
}
