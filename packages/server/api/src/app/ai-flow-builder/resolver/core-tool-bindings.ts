import { WorkflowTriggerKind } from '@activepieces/shared'

const SCHEDULE = { pieceName: '@activepieces/piece-schedule', objectName: 'cron_expression' }
const MANUAL = { pieceName: '@activepieces/piece-manual-trigger', objectName: 'manual_trigger' }
const WEBHOOK = { pieceName: '@activepieces/piece-webhook', objectName: 'catch_webhook' }
const HTTP = { pieceName: '@activepieces/piece-http', objectName: 'send_request' }

const GENERIC_PIECE_NAMES: ReadonlySet<string> = new Set([
    HTTP.pieceName,
    WEBHOOK.pieceName,
    '@activepieces/piece-code',
    '@activepieces/piece-smtp',
    '@activepieces/piece-data-mapper',
    '@activepieces/piece-store',
])

function triggerFor({ kind }: { kind: WorkflowTriggerKind }): CoreBinding | null {
    switch (kind) {
        case WorkflowTriggerKind.SCHEDULE:
            return SCHEDULE
        case WorkflowTriggerKind.MANUAL:
            return MANUAL
        case WorkflowTriggerKind.EVENT:
            return null
    }
}

function isGeneric({ pieceName }: { pieceName: string }): boolean {
    return GENERIC_PIECE_NAMES.has(pieceName)
}

export const coreTools = {
    httpFallback: HTTP,
    webhookFallback: WEBHOOK,
    triggerFor,
    isGeneric,
}

export type CoreBinding = {
    pieceName: string
    objectName: string
}
