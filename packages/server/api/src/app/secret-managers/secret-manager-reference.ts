import { isNil } from '@activepieces/core-utils'
import { SecretManagerFieldsSeparator } from '@activepieces/shared'

function parse(value: string): SecretManagerReference | null {
    const trimmed = value.trim()
    if (!trimmed.startsWith('{{') || !trimmed.endsWith('}}')) {
        return null
    }
    const inner = trimmed.slice(2, -2)
    const separatorAt = inner.indexOf(SecretManagerFieldsSeparator)
    if (separatorAt < 0) {
        return null
    }
    const connectionId = inner.slice(0, separatorAt).trim()
    const path = inner.slice(separatorAt + SecretManagerFieldsSeparator.length).trim()
    if (connectionId.length === 0 || path.length === 0) {
        return null
    }
    return { connectionId, path }
}

function contains(value: unknown): boolean {
    if (typeof value === 'string') {
        return !isNil(parse(value))
    }
    if (Array.isArray(value)) {
        return value.some(contains)
    }
    if (typeof value === 'object' && !isNil(value)) {
        return Object.values(value).some(contains)
    }
    return false
}

export const secretManagerReference = { parse, contains }

export type SecretManagerReference = {
    connectionId: string
    path: string
}
