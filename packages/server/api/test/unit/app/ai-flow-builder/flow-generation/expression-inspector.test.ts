import { describe, expect, it } from 'vitest'
import { ExpressionKind, expressionInspector } from '../../../../../src/app/ai-flow-builder/flow-generation/expression-inspector'

function inspect(input: unknown) {
    return expressionInspector.inspect({ input })
}

describe('expressionInspector', () => {
    it('reads a step output reference and its field path', () => {
        const [expression] = inspect({ message: "{{step_1['output'].body.price}}" })

        expect(expression).toMatchObject({
            kind: ExpressionKind.STEP_OUTPUT,
            stepName: 'step_1',
            fieldPath: 'body.price',
            propertyPath: 'message',
        })
    })

    it('reads a whole step output with no field path', () => {
        expect(inspect({ message: "{{step_1['output']}}" })[0]).toMatchObject({ stepName: 'step_1', fieldPath: null })
    })

    it('reads the trigger the same way as any other step', () => {
        expect(inspect({ to: "{{trigger['output'].email}}" })[0]).toMatchObject({ stepName: 'trigger', fieldPath: 'email' })
    })

    it('recognises a continue-on-failure error reference', () => {
        expect(inspect({ text: "{{step_2['error'].message}}" })[0]).toMatchObject({ kind: ExpressionKind.STEP_ERROR, stepName: 'step_2' })
    })

    it('recognises a connection reference and claims no step', () => {
        expect(inspect({ auth: "{{connections['conn_abc']}}" })[0]).toMatchObject({ kind: ExpressionKind.CONNECTION, stepName: null })
    })

    it('finds expressions nested inside objects and arrays', () => {
        const found = inspect({ body: { rows: ["{{step_1['output'].a}}", { deep: "{{step_2['output'].b}}" }] } })

        expect(found.map((expression) => expression.propertyPath)).toEqual(['body.rows.0', 'body.rows.1.deep'])
    })

    it('finds several expressions inside one string', () => {
        expect(inspect({ text: "{{step_1['output'].a}} and {{step_2['output'].b}}" }).map((e) => e.stepName)).toEqual(['step_1', 'step_2'])
    })

    it('treats an expression it cannot model as opaque rather than broken', () => {
        expect(inspect({ text: "{{ step_1['output'].price + 2 }}" })[0].kind).toBe(ExpressionKind.OPAQUE)
        expect(inspect({ text: '{{ Math.max(1, 2) }}' })[0].kind).toBe(ExpressionKind.OPAQUE)
    })

    it('flags an empty expression', () => {
        expect(inspect({ text: '{{}}' })[0].kind).toBe(ExpressionKind.MALFORMED)
    })

    it('flags unbalanced brackets and quotes', () => {
        expect(inspect({ text: "{{step_1['output'}}" })[0].kind).toBe(ExpressionKind.MALFORMED)
        expect(inspect({ text: "{{step_1['output].a}}" })[0].kind).toBe(ExpressionKind.MALFORMED)
        expect(inspect({ text: '{{ foo( }}' })[0].kind).toBe(ExpressionKind.MALFORMED)
    })

    it('does not mistake plain text for an expression', () => {
        expect(inspect({ text: 'send the report at 7' })).toEqual([])
    })

    it('handles an object literal inside an expression without truncating it', () => {
        expect(inspect({ text: '{{ {a: 1} }}' })[0].kind).toBe(ExpressionKind.OPAQUE)
    })

    it('reads a bracketed field path', () => {
        expect(inspect({ text: "{{step_1['output']['some key'].id}}" })[0].fieldPath).toBe('some key.id')
    })

    it('reads an indexed field path', () => {
        expect(inspect({ text: "{{step_1['output'].items[0].id}}" })[0].fieldPath).toBe('items.0.id')
    })
})
