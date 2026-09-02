import { AppConnectionScope, ConnectionBindingReason, ConnectionBindingStatus } from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import { SafeConnection } from '../../../../../src/app/app-connection/app-connection-service/app-connection-service'
import { credentialBinder } from '../../../../../src/app/ai-flow-builder/resolver/credential-binder'

const GMAIL = '@activepieces/piece-gmail'
const TELEGRAM = '@activepieces/piece-telegram-bot'
const SLACK = '@activepieces/piece-slack'

function connection({ pieceName, displayName, externalId }: { pieceName: string, displayName: string, externalId: string }): SafeConnection {
    return { pieceName, displayName, externalId, scope: AppConnectionScope.PROJECT }
}

function bind({ pieceName = GMAIL, pieceDisplayName = 'Gmail', requestText = 'Send the report', connections = [], used = [], requiresConnection = true }: BindOverrides = {}) {
    return credentialBinder.bind({
        requiresConnection,
        pieceName,
        pieceDisplayName,
        requestText,
        connections,
        connectionsUsedByProject: new Set(used),
    })
}

const GMAIL_PERSONAL = connection({ pieceName: GMAIL, displayName: 'Gmail Personal', externalId: 'conn_gmail_personal' })
const GMAIL_WORK = connection({ pieceName: GMAIL, displayName: 'Gmail Work', externalId: 'conn_gmail_work' })
const TELEGRAM_PERSONAL = connection({ pieceName: TELEGRAM, displayName: 'Telegram Personal', externalId: 'conn_telegram_personal' })
const SLACK_WORK = connection({ pieceName: SLACK, displayName: 'Slack Work', externalId: 'conn_slack_work' })
const SLACK_SUPPORT = connection({ pieceName: SLACK, displayName: 'Slack Support', externalId: 'conn_slack_support' })

describe('credentialBinder', () => {
    it('binds nothing for a piece that needs no account', () => {
        const result = bind({ requiresConnection: false, connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.NOT_REQUIRED,
            reason: ConnectionBindingReason.PIECE_NEEDS_NO_ACCOUNT,
            externalId: null,
        })
    })

    it('binds the only Gmail connection without asking', () => {
        const result = bind({ connections: [GMAIL_PERSONAL, TELEGRAM_PERSONAL, SLACK_WORK] })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.ONLY_ACCOUNT_CONNECTED,
            externalId: 'conn_gmail_personal',
            displayName: 'Gmail Personal',
        })
    })

    it('binds the only Telegram connection for "Send the result to my Telegram"', () => {
        const result = bind({
            pieceName: TELEGRAM,
            pieceDisplayName: 'Telegram Bot',
            requestText: 'Send the result to my Telegram',
            connections: [TELEGRAM_PERSONAL, GMAIL_PERSONAL, GMAIL_WORK, SLACK_WORK],
        })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.ONLY_ACCOUNT_CONNECTED,
            externalId: 'conn_telegram_personal',
        })
    })

    it('reports a missing Telegram connection without guessing another app', () => {
        const result = bind({
            pieceName: TELEGRAM,
            pieceDisplayName: 'Telegram Bot',
            requestText: 'Send the result to my Telegram',
            connections: [GMAIL_PERSONAL, SLACK_WORK],
        })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.MISSING,
            reason: ConnectionBindingReason.NO_ACCOUNT_CONNECTED,
            externalId: null,
        })
        expect(result.options).toEqual([])
    })

    it('asks which account to use when personal and work Gmail both exist', () => {
        const result = bind({ requestText: 'Email the renewal report', connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.NEEDS_SELECTION,
            reason: ConnectionBindingReason.SEVERAL_ACCOUNTS_MATCH,
            externalId: null,
        })
        expect(result.options).toEqual([
            { externalId: 'conn_gmail_personal', displayName: 'Gmail Personal' },
            { externalId: 'conn_gmail_work', displayName: 'Gmail Work' },
        ])
    })

    it('binds the work account when the request names it', () => {
        const result = bind({ requestText: 'Send the renewal report from my work Gmail', connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.NAMED_IN_REQUEST,
            externalId: 'conn_gmail_work',
        })
    })

    it('binds the personal account when the request names that instead', () => {
        const result = bind({ requestText: 'Send it from my personal Gmail', connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        expect(result.externalId).toBe('conn_gmail_personal')
    })

    it('ignores the app name itself when matching, so "Gmail" alone stays ambiguous', () => {
        const result = bind({ requestText: 'Send the report over Gmail', connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        expect(result.status).toBe(ConnectionBindingStatus.NEEDS_SELECTION)
    })

    it('asks rather than guessing when two accounts share the named word', () => {
        const duplicate = connection({ pieceName: GMAIL, displayName: 'Work Gmail Archive', externalId: 'conn_gmail_work_two' })

        const result = bind({ requestText: 'Send it from my work Gmail', connections: [GMAIL_WORK, duplicate] })

        expect(result.status).toBe(ConnectionBindingStatus.NEEDS_SELECTION)
        expect(result.options).toHaveLength(2)
    })

    it('falls back to the account this project already uses for that app', () => {
        const result = bind({
            pieceName: SLACK,
            pieceDisplayName: 'Slack',
            requestText: 'Post the summary to Slack',
            connections: [SLACK_WORK, SLACK_SUPPORT],
            used: ['conn_slack_support'],
        })

        expect(result).toMatchObject({
            status: ConnectionBindingStatus.BOUND,
            reason: ConnectionBindingReason.ALREADY_USED_BY_THIS_PROJECT,
            externalId: 'conn_slack_support',
        })
    })

    it('asks when the project already uses several accounts for the same app', () => {
        const result = bind({
            pieceName: SLACK,
            pieceDisplayName: 'Slack',
            requestText: 'Post the summary to Slack',
            connections: [SLACK_WORK, SLACK_SUPPORT],
            used: ['conn_slack_support', 'conn_slack_work'],
        })

        expect(result.status).toBe(ConnectionBindingStatus.NEEDS_SELECTION)
    })

    it('prefers the account the request names over the one the project usually uses', () => {
        const result = bind({
            requestText: 'Send it from my work Gmail',
            connections: [GMAIL_PERSONAL, GMAIL_WORK],
            used: ['conn_gmail_personal'],
        })

        expect(result).toMatchObject({
            reason: ConnectionBindingReason.NAMED_IN_REQUEST,
            externalId: 'conn_gmail_work',
        })
    })

    it('never returns a connection belonging to a different piece', () => {
        const result = bind({ pieceName: TELEGRAM, pieceDisplayName: 'Telegram Bot', connections: [GMAIL_WORK, SLACK_WORK] })

        expect(result.status).toBe(ConnectionBindingStatus.MISSING)
        expect(result.externalId).toBeNull()
    })

    it('offers only display names and opaque ids, never anything else from the connection', () => {
        const result = bind({ requestText: 'Email the report', connections: [GMAIL_PERSONAL, GMAIL_WORK] })

        for (const option of result.options) {
            expect(Object.keys(option).sort()).toEqual(['displayName', 'externalId'])
        }
    })
})

type BindOverrides = {
    pieceName?: string
    pieceDisplayName?: string
    requestText?: string
    connections?: SafeConnection[]
    used?: string[]
    requiresConnection?: boolean
}
