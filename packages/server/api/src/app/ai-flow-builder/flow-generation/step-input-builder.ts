import { isNil } from '@activepieces/core-utils'
import { ActionBase, PropertyType, TriggerBase } from '@activepieces/pieces-framework'
import { ConnectionBindingStatus, GeneratedStepRequirement, ResolvedConnection } from '@activepieces/shared'

const AUTH_PROPERTY = 'auth'

const NON_INPUT_PROPERTY_TYPES: ReadonlySet<PropertyType> = new Set([
    PropertyType.OAUTH2,
    PropertyType.SECRET_TEXT,
    PropertyType.BASIC_AUTH,
    PropertyType.CUSTOM_AUTH,
    PropertyType.MARKDOWN,
])

const BUILDER_RESOLVED_TYPES: ReadonlySet<PropertyType> = new Set([
    PropertyType.DROPDOWN,
    PropertyType.MULTI_SELECT_DROPDOWN,
    PropertyType.DYNAMIC,
])

export const stepInputBuilder = {
    build({ object, connection, upstreamStepName, seededInput = {} }: BuildParams): StepInput {
        const properties = Object.entries(object.props).filter(([, property]) => !NON_INPUT_PROPERTY_TYPES.has(property.type))
        const known = new Set(properties.map(([name]) => name))

        const declaredDefaults = Object.fromEntries(properties.flatMap(([name, property]) => {
            const fallback = defaultFor({ property })
            return isNil(fallback) ? [] : [[name, fallback]]
        }))

        const seeded = Object.fromEntries(Object.entries(seededInput).filter(([name]) => known.has(name)))
        const withConnection = connectionEntry({ connection })
        const filled = { ...declaredDefaults, ...seeded, ...withConnection }

        const unfilled = properties.filter(([name, property]) => property.required && isEmpty(filled[name]))
        const reference = referenceEntry({ unfilled, upstreamStepName })

        return {
            input: { ...filled, ...reference },
            missingProperties: unfilled.map(([name]) => name),
            requirements: requirementsFor({ connection, unfilled }),
        }
    },
}

function connectionEntry({ connection }: { connection: ResolvedConnection }): Record<string, string> {
    if (connection.status !== ConnectionBindingStatus.BOUND || isNil(connection.externalId)) {
        return {}
    }
    return { [AUTH_PROPERTY]: `{{connections['${connection.externalId}']}}` }
}

function referenceEntry({ unfilled, upstreamStepName }: { unfilled: PropertyEntry[], upstreamStepName: string | null }): Record<string, string> {
    if (isNil(upstreamStepName)) {
        return {}
    }
    const target = referenceTarget({ unfilled })
    if (isNil(target)) {
        return {}
    }
    return { [target]: `{{${upstreamStepName}['output']}}` }
}

function referenceTarget({ unfilled }: { unfilled: PropertyEntry[] }): string | null {
    const bodies = unfilled.filter(([, property]) => property.type === PropertyType.LONG_TEXT)
    return bodies.length === 1 ? bodies[0][0] : null
}

function requirementsFor({ connection, unfilled }: { connection: ResolvedConnection, unfilled: PropertyEntry[] }): GeneratedStepRequirement[] {
    const connectionRequirement = connectionRequirementFor({ connection })
    const needsBuilder = unfilled.some(([, property]) => BUILDER_RESOLVED_TYPES.has(property.type))
    const needsTyping = unfilled.some(([, property]) => !BUILDER_RESOLVED_TYPES.has(property.type))
    return [
        ...(isNil(connectionRequirement) ? [] : [connectionRequirement]),
        ...(needsBuilder ? [GeneratedStepRequirement.INPUT_NEEDS_BUILDER] : []),
        ...(needsTyping ? [GeneratedStepRequirement.REQUIRED_INPUT] : []),
    ]
}

function connectionRequirementFor({ connection }: { connection: ResolvedConnection }): GeneratedStepRequirement | null {
    switch (connection.status) {
        case ConnectionBindingStatus.MISSING:
            return GeneratedStepRequirement.CONNECTION_MISSING
        case ConnectionBindingStatus.NEEDS_SELECTION:
            return GeneratedStepRequirement.CONNECTION_CHOICE
        case ConnectionBindingStatus.BOUND:
        case ConnectionBindingStatus.NOT_REQUIRED:
            return null
    }
}

function defaultFor({ property }: { property: PropertyEntry[1] }): unknown {
    if (!isNil(property.defaultValue)) {
        return property.defaultValue
    }
    switch (property.type) {
        case PropertyType.ARRAY:
            return []
        case PropertyType.OBJECT:
        case PropertyType.DYNAMIC:
            return {}
        case PropertyType.CHECKBOX:
            return false
        default:
            return null
    }
}

function isEmpty(value: unknown): boolean {
    return isNil(value) || value === ''
}

type PropertyEntry = [string, (ActionBase | TriggerBase)['props'][string]]

type BuildParams = {
    object: ActionBase | TriggerBase
    connection: ResolvedConnection
    upstreamStepName: string | null
    seededInput?: Record<string, unknown>
}

export type StepInput = {
    input: Record<string, unknown>
    missingProperties: string[]
    requirements: GeneratedStepRequirement[]
}
