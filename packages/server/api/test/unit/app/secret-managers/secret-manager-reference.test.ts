import { SecretManagerFieldsSeparator } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { secretManagerReference } from '../../../../src/app/secret-managers/secret-manager-reference'

const reference = (connectionId: string, path: string): string =>
    `{{${connectionId}${SecretManagerFieldsSeparator}${path}}}`

describe('secretManagerReference.parse', () => {
    it('reads the connection id and the path out of a reference', () => {
        expect(secretManagerReference.parse(reference('conn-1', 'secret/data/keys/api-key')))
            .toEqual({ connectionId: 'conn-1', path: 'secret/data/keys/api-key' })
    })

    it('keeps every later separator inside the path', () => {
        const path = `a${SecretManagerFieldsSeparator}b`
        expect(secretManagerReference.parse(reference('conn-1', path)))
            .toEqual({ connectionId: 'conn-1', path })
    })

    it('tolerates surrounding whitespace', () => {
        expect(secretManagerReference.parse(`  ${reference('conn-1', 'p')}  `))
            .toEqual({ connectionId: 'conn-1', path: 'p' })
    })

    it.each([
        ['a plain password', 'hunter2'],
        ['an empty string', ''],
        ['a mustache with no separator', '{{connections["gmail"]}}'],
        ['a step reference', "{{step_1['output'].token}}"],
        ['a separator with no braces', `conn-1${SecretManagerFieldsSeparator}path`],
        ['an unclosed reference', `{{conn-1${SecretManagerFieldsSeparator}path`],
        ['a missing connection id', `{{${SecretManagerFieldsSeparator}path}}`],
        ['a missing path', `{{conn-1${SecretManagerFieldsSeparator}}}`],
    ])('returns null for %s', (_label, value) => {
        expect(secretManagerReference.parse(value)).toBeNull()
    })
})

describe('secretManagerReference.contains', () => {
    it('finds a reference nested in an object', () => {
        expect(secretManagerReference.contains({
            auth: { apiKey: reference('conn-1', 'path') },
        })).toBe(true)
    })

    it('finds a reference nested in an array', () => {
        expect(secretManagerReference.contains({
            headers: ['plain', reference('conn-1', 'path')],
        })).toBe(true)
    })

    it.each([
        ['a plain value object', { apiKey: 'hunter2', url: 'https://example.com' }],
        ['an OAuth2 connection value', { access_token: 'ya29.abc', client_id: 'id', expires_in: 3600 }],
        ['a null value', null],
        ['a number', 42],
    ])('returns false for %s', (_label, value) => {
        expect(secretManagerReference.contains(value)).toBe(false)
    })
})
