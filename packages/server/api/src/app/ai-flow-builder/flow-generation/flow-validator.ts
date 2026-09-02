import { isNil, tryCatch } from '@activepieces/core-utils'
import { ActionBase, isReadOnlyClassification, OutputSchemaField, PieceMetadataModel, TriggerBase } from '@activepieces/pieces-framework'
import {
    FlowActionType,
    FlowReadiness,
    flowStructureUtil,
    FlowTriggerType,
    FlowValidationIssue,
    FlowValidationRule,
    FlowValidationSeverity,
    FlowVersion,
    Step,
    StepTestability,
    ValidatedStep,
    ValidateGeneratedFlowResponse,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { expressionInspector, ExpressionKind } from './expression-inspector'

const NON_INPUT_PROPERTY_TYPES: ReadonlySet<string> = new Set(['OAUTH2', 'SECRET_TEXT', 'BASIC_AUTH', 'CUSTOM_AUTH', 'MARKDOWN'])

export const flowValidator = (log: FastifyBaseLogger): FlowValidator => ({
    async validate({ flowVersion, projectId, platformId }: ValidateParams): Promise<ValidateGeneratedFlowResponse> {
        const ordered = flowStructureUtil.getAllSteps(flowVersion.trigger)
        const reachable = new Set(ordered.map((step) => step.name))
        const pieces = await loadPieces({ steps: ordered, projectId, platformId, log })

        const steps = ordered.map((step, index) => validateStep({
            step,
            index,
            earlier: ordered.slice(0, index),
            pieces,
            reachable,
        }))

        const issues = [
            ...structureIssues({ flowVersion, ordered }),
            ...steps.flatMap((step) => step.issues),
        ]
        const errors = issues.filter((issue) => issue.severity === FlowValidationSeverity.ERROR)

        return {
            readiness: readinessOf({ errors }),
            publishable: errors.length === 0,
            flowVersionId: flowVersion.id,
            steps,
            issues,
        }
    },
})

function validateStep({ step, index, earlier, pieces, reachable }: ValidateStepParams): ValidatedStep {
    const isTrigger = index === 0
    const component = componentOf({ step, pieces })
    const issues = [
        ...componentIssues({ step, isTrigger, component }),
        ...propertyIssues({ step, component }),
        ...connectionIssues({ step, component }),
        ...expressionIssues({ step, earlier, pieces, reachable }),
    ]

    return {
        stepName: step.name,
        displayName: step.displayName,
        pieceName: pieceNameOf({ step }),
        isTrigger,
        valid: step.valid && issues.every((issue) => issue.severity !== FlowValidationSeverity.ERROR),
        testability: testabilityOf({ step, isTrigger, component, issues }),
        issues,
    }
}

function componentIssues({ step, isTrigger, component }: { step: Step, isTrigger: boolean, component: Component | null }): FlowValidationIssue[] {
    if (isTrigger && step.type === FlowTriggerType.EMPTY) {
        return [issue({ rule: FlowValidationRule.TRIGGER_NOT_CONFIGURED, stepName: step.name, detail: 'The flow has no trigger configured' })]
    }
    const pieceName = pieceNameOf({ step })
    if (isNil(pieceName)) {
        return []
    }
    if (isNil(component)) {
        return [issue({ rule: FlowValidationRule.PIECE_NOT_FOUND, stepName: step.name, detail: `The piece ${pieceName} is not available in this project` })]
    }
    if (isNil(component.object)) {
        return [issue({ rule: FlowValidationRule.COMPONENT_NOT_FOUND, stepName: step.name, detail: `${pieceName} does not have ${component.objectName}` })]
    }
    return []
}

function propertyIssues({ step, component }: { step: Step, component: Component | null }): FlowValidationIssue[] {
    if (isNil(component?.object)) {
        return []
    }
    const input = inputOf({ step })
    const declared = Object.entries(component.object.props).filter(([, property]) => !NON_INPUT_PROPERTY_TYPES.has(property.type))
    const declaredNames = new Set(declared.map(([name]) => name))

    const missing = declared
        .filter(([name, property]) => property.required && isEmpty(input[name]))
        .map(([name]) => issue({
            rule: FlowValidationRule.REQUIRED_PROPERTY_MISSING,
            stepName: step.name,
            propertyName: name,
            detail: `${step.displayName} needs ${name}`,
        }))

    const unknown = Object.keys(input)
        .filter((name) => name !== 'auth' && !declaredNames.has(name))
        .map((name) => issue({
            rule: FlowValidationRule.UNKNOWN_PROPERTY,
            severity: FlowValidationSeverity.WARNING,
            stepName: step.name,
            propertyName: name,
            detail: `${name} is not a property of ${component.objectName}`,
        }))

    return [...missing, ...unknown]
}

function connectionIssues({ step, component }: { step: Step, component: Component | null }): FlowValidationIssue[] {
    if (isNil(component?.object)) {
        return []
    }
    const needsAccount = !isNil(component.piece.auth) && (component.object.requireAuth ?? true)
    if (!needsAccount || !isEmpty(inputOf({ step }).auth)) {
        return []
    }
    return [issue({
        rule: FlowValidationRule.CONNECTION_MISSING,
        stepName: step.name,
        propertyName: 'auth',
        detail: `${component.piece.displayName} needs a connected account`,
    })]
}

function expressionIssues({ step, earlier, pieces, reachable }: ExpressionIssueParams): FlowValidationIssue[] {
    const earlierNames = new Set(earlier.map((candidate) => candidate.name))
    return expressionInspector.inspect({ input: inputOf({ step }) }).flatMap((expression) => {
        if (expression.kind === ExpressionKind.MALFORMED) {
            return [issue({
                rule: FlowValidationRule.MALFORMED_EXPRESSION,
                stepName: step.name,
                propertyName: expression.propertyPath,
                detail: `{{${expression.body}}} is not a valid expression`,
            })]
        }
        if (isNil(expression.stepName)) {
            return []
        }
        if (!reachable.has(expression.stepName)) {
            return [issue({
                rule: FlowValidationRule.UNKNOWN_STEP_REFERENCE,
                stepName: step.name,
                propertyName: expression.propertyPath,
                detail: `${expression.propertyPath} refers to ${expression.stepName}, which is not a step in this flow`,
            })]
        }
        if (!earlierNames.has(expression.stepName)) {
            return [issue({
                rule: FlowValidationRule.FORWARD_STEP_REFERENCE,
                stepName: step.name,
                propertyName: expression.propertyPath,
                detail: `${expression.propertyPath} refers to ${expression.stepName}, which runs later`,
            })]
        }
        return outputFieldIssues({ step, expression, earlier, pieces })
    })
}

function outputFieldIssues({ step, expression, earlier, pieces }: OutputFieldParams): FlowValidationIssue[] {
    if (expression.kind !== ExpressionKind.STEP_OUTPUT || isNil(expression.fieldPath) || isNil(expression.stepName)) {
        return []
    }
    const source = earlier.find((candidate) => candidate.name === expression.stepName)
    const component = isNil(source) ? null : componentOf({ step: source, pieces })
    const schema = component?.object?.outputSchema
    if (isNil(schema)) {
        return []
    }
    const known = knownFieldPaths({ fields: schema.fields ?? [] })
    if (known.length === 0 || known.some((path) => matches({ known: path, referenced: expression.fieldPath ?? '' }))) {
        return []
    }
    return [issue({
        rule: FlowValidationRule.UNKNOWN_OUTPUT_FIELD,
        severity: FlowValidationSeverity.WARNING,
        stepName: step.name,
        propertyName: expression.propertyPath,
        detail: `${expression.stepName} does not document an output field called ${expression.fieldPath}`,
    })]
}

function knownFieldPaths({ fields, prefix = '' }: { fields: OutputSchemaField[], prefix?: string }): string[] {
    return fields.flatMap((field) => {
        const segment = field.value ?? field.key
        const path = segment === '' ? prefix : (prefix === '' ? segment : `${prefix}.${segment}`)
        const children = field.children ?? field.listItems ?? []
        if (children.length > 0) {
            return [path, ...knownFieldPaths({ fields: children, prefix: path })]
        }
        return path === '' ? [] : [path]
    })
}

function matches({ known, referenced }: { known: string, referenced: string }): boolean {
    const normalise = (path: string): string => path.replace(/\.\[\]/g, '').replace(/\.\d+/g, '')
    const left = normalise(known)
    const right = normalise(referenced)
    return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)
}

function structureIssues({ flowVersion, ordered }: { flowVersion: FlowVersion, ordered: Step[] }): FlowValidationIssue[] {
    const empty = ordered.length > 1 ? [] : [issue({
        rule: FlowValidationRule.EMPTY_FLOW,
        stepName: flowVersion.trigger.name,
        detail: 'The flow has a trigger but no steps to run',
    })]

    const seen = new Set<string>()
    const duplicates = ordered.flatMap((step) => {
        if (seen.has(step.name)) {
            return [issue({
                rule: FlowValidationRule.DUPLICATE_STEP_NAME,
                stepName: step.name,
                detail: `More than one step is called ${step.name}, so references to it are ambiguous`,
            })]
        }
        seen.add(step.name)
        return []
    })

    return [...empty, ...duplicates]
}

function readinessOf({ errors }: { errors: FlowValidationIssue[] }): FlowReadiness {
    if (errors.length === 0) {
        return FlowReadiness.READY
    }
    const onlyConnections = errors.every((error) => error.rule === FlowValidationRule.CONNECTION_MISSING)
    return onlyConnections ? FlowReadiness.MISSING_CONNECTION : FlowReadiness.NEEDS_REPAIR
}

function testabilityOf({ step, isTrigger, component, issues }: TestabilityParams): StepTestability {
    if (isTrigger || step.type !== FlowActionType.PIECE || isNil(component?.object)) {
        return StepTestability.NOT_APPLICABLE
    }
    if (issues.some((candidate) => candidate.severity === FlowValidationSeverity.ERROR) || !step.valid) {
        return StepTestability.NOT_CONFIGURED
    }
    return isReadOnlyClassification(component.object.classification)
        ? StepTestability.TESTABLE
        : StepTestability.UNSAFE_TO_AUTO_TEST
}

async function loadPieces({ steps, projectId, platformId, log }: LoadPiecesParams): Promise<Map<string, PieceMetadataModel | null>> {
    const names = [...new Set(steps.map((step) => pieceNameOf({ step })).filter((name): name is string => !isNil(name)))]
    const loaded = await Promise.all(names.map(async (name) => {
        const { data } = await tryCatch(() => pieceMetadataService(log).get({ name, projectId, platformId }))
        return [name, data ?? null] as const
    }))
    return new Map(loaded)
}

function componentOf({ step, pieces }: { step: Step, pieces: Map<string, PieceMetadataModel | null> }): Component | null {
    const pieceName = pieceNameOf({ step })
    if (isNil(pieceName)) {
        return null
    }
    const piece = pieces.get(pieceName)
    if (isNil(piece)) {
        return null
    }
    const objectName = step.type === FlowTriggerType.PIECE
        ? String(step.settings.triggerName ?? '')
        : String(step.settings.actionName ?? '')
    const object = step.type === FlowTriggerType.PIECE ? piece.triggers[objectName] : piece.actions[objectName]
    return { piece, objectName, object: object ?? null }
}

function pieceNameOf({ step }: { step: Step }): string | null {
    if (step.type !== FlowTriggerType.PIECE && step.type !== FlowActionType.PIECE) {
        return null
    }
    const name = step.settings.pieceName
    return typeof name === 'string' ? name : null
}

function inputOf({ step }: { step: Step }): Record<string, unknown> {
    const input = 'input' in step.settings ? step.settings.input : undefined
    return typeof input === 'object' && !isNil(input) ? input : {}
}

function isEmpty(value: unknown): boolean {
    return isNil(value) || value === ''
}

function issue({ rule, severity = FlowValidationSeverity.ERROR, stepName, propertyName = null, detail }: IssueParams): FlowValidationIssue {
    return { rule, severity, stepName, propertyName, detail }
}

type Component = {
    piece: PieceMetadataModel
    objectName: string
    object: ActionBase | TriggerBase | null
}

type IssueParams = {
    rule: FlowValidationRule
    severity?: FlowValidationSeverity
    stepName: string | null
    propertyName?: string | null
    detail: string
}

type TestabilityParams = {
    step: Step
    isTrigger: boolean
    component: Component | null
    issues: FlowValidationIssue[]
}

type OutputFieldParams = {
    step: Step
    expression: ReturnType<typeof expressionInspector.inspect>[number]
    earlier: Step[]
    pieces: Map<string, PieceMetadataModel | null>
}

type ExpressionIssueParams = {
    step: Step
    earlier: Step[]
    pieces: Map<string, PieceMetadataModel | null>
    reachable: ReadonlySet<string>
}

type ValidateStepParams = {
    step: Step
    index: number
    earlier: Step[]
    pieces: Map<string, PieceMetadataModel | null>
    reachable: ReadonlySet<string>
}

type LoadPiecesParams = {
    steps: Step[]
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}

type ValidateParams = {
    flowVersion: FlowVersion
    projectId: string
    platformId: string
}

type FlowValidator = {
    validate(params: ValidateParams): Promise<ValidateGeneratedFlowResponse>
}
