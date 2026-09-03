import { ActionBase, PieceAuth, Property, TriggerBase } from '@activepieces/pieces-framework'
import { PackageType, PieceCategory, PieceType, TriggerStrategy, TriggerTestStrategy } from '@activepieces/shared'
import { db } from './db'
import { createMockPieceMetadata } from './mocks'

export const resolverPieces = {
    async seed({ platformId }: { platformId: string }): Promise<void> {
        await Promise.all(CATALOG.map((piece) => db.save('piece_metadata', createMockPieceMetadata({
            name: piece.name,
            displayName: piece.displayName,
            description: piece.description,
            categories: piece.categories,
            auth: piece.requiresAuth ? SECRET_AUTH : undefined,
            actions: byName(piece.actions ?? []),
            triggers: byName(piece.triggers ?? []),
            platformId,
            packageType: PackageType.REGISTRY,
            pieceType: PieceType.CUSTOM,
            version: '1.0.0',
            minimumSupportedRelease: '0.0.0',
            maximumSupportedRelease: '999.999.999',
        }))))
    },
}

function action({ name, displayName, description, aiDescription, classification, required = [], audience = 'both' }: ActionSeed): ActionBase {
    return {
        name,
        displayName,
        description,
        props: properties(required),
        requireAuth: true,
        audience,
        classification,
        ...(aiDescription === undefined ? {} : { aiMetadata: { description: aiDescription } }),
    }
}

function trigger({ name, displayName, description, required = [] }: TriggerSeed): TriggerBase {
    return {
        name,
        displayName,
        description,
        props: properties(required),
        requireAuth: true,
        type: TriggerStrategy.POLLING,
        testStrategy: TriggerTestStrategy.SIMULATION,
        sampleData: {},
    }
}

function properties(required: RequiredProp[]): ActionBase['props'] {
    return Object.fromEntries(required.map((entry) => {
        const spec = typeof entry === 'string' ? { name: entry, type: 'SHORT_TEXT' as const } : entry
        return [spec.name, propertyOf({ spec })]
    }))
}

function propertyOf({ spec }: { spec: PropSpec }): ActionBase['props'][string] {
    switch (spec.type) {
        case 'LONG_TEXT':
            return Property.LongText({ displayName: spec.name, required: true })
        case 'DROPDOWN':
            return Property.Dropdown({ displayName: spec.name, required: true, auth: SECRET_AUTH, refreshers: [], options: async () => ({ disabled: true, options: [], placeholder: 'Connect your account first' }) })
        case 'OBJECT':
            return Property.Object({ displayName: spec.name, required: true })
        case 'STATIC_DROPDOWN':
            return Property.StaticDropdown({ displayName: spec.name, required: true, options: { options: [{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }] }, defaultValue: spec.defaultValue })
        case 'SHORT_TEXT':
            return Property.ShortText({ displayName: spec.name, required: true })
    }
}

function byName<T extends { name: string }>(entries: T[]): Record<string, T> {
    return Object.fromEntries(entries.map((entry) => [entry.name, entry]))
}

const SECRET_AUTH = PieceAuth.SecretText({ displayName: 'Connection', required: true })

const CATALOG: PieceSeed[] = [
    {
        name: '@activepieces/piece-schedule',
        displayName: 'Schedule',
        description: 'Trigger flow with fixed schedule',
        categories: [PieceCategory.CORE],
        requiresAuth: false,
        triggers: [
            trigger({ name: 'cron_expression', displayName: 'Cron Expression', description: 'Trigger the flow on a cron schedule', required: ['cronExpression', 'timezone'] }),
            trigger({ name: 'every_day', displayName: 'Every Day', description: 'Trigger the flow every day', required: ['hour'] }),
        ],
    },
    {
        name: '@activepieces/piece-webhook',
        displayName: 'Webhook',
        description: 'Receive HTTP requests and trigger flows using unique URLs',
        categories: [PieceCategory.CORE],
        requiresAuth: false,
        triggers: [trigger({ name: 'catch_webhook', displayName: 'Catch Webhook', description: 'Receive an incoming HTTP request' })],
    },
    {
        name: '@activepieces/piece-manual-trigger',
        displayName: 'Manual Trigger',
        description: 'Start the flow by hand',
        categories: [PieceCategory.CORE],
        requiresAuth: false,
        triggers: [trigger({ name: 'manual_trigger', displayName: 'Manual Trigger', description: 'Start the flow manually' })],
    },
    {
        name: '@activepieces/piece-http',
        displayName: 'HTTP',
        description: 'Sends HTTP requests and return responses',
        categories: [PieceCategory.CORE],
        requiresAuth: false,
        actions: [
            action({ name: 'send_request', displayName: 'Send HTTP request', description: 'Send HTTP request', classification: 'WRITE', required: [{ name: 'method', type: 'STATIC_DROPDOWN' }, 'url', { name: 'headers', type: 'OBJECT' }, { name: 'queryParams', type: 'OBJECT' }, { name: 'authType', type: 'STATIC_DROPDOWN', defaultValue: 'NONE' }] }),
            action({ name: 'parse_url', displayName: 'Parse URL', description: 'Extract the domain, path, and query parameters from a URL.', classification: 'READ', required: ['url'] }),
        ],
    },
    {
        name: '@activepieces/piece-gmail',
        displayName: 'Gmail',
        description: 'Email service by Google',
        categories: [PieceCategory.COMMUNICATION],
        requiresAuth: true,
        actions: [
            action({ name: 'send_email', displayName: 'Send Email', description: 'Send an email through Gmail', classification: 'WRITE', required: ['to', 'subject'] }),
            action({ name: 'gmail_search_email', displayName: 'Search Email', description: 'Search for an email in the mailbox', classification: 'SEARCH', required: ['query'] }),
        ],
        triggers: [trigger({ name: 'gmail_new_email_received', displayName: 'New Email', description: 'Triggers when a new email is received' })],
    },
    {
        name: '@activepieces/piece-microsoft-outlook',
        displayName: 'Microsoft Outlook',
        description: '',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [
            action({ name: 'send-email', displayName: 'Send Email', description: 'Send an email from Outlook', classification: 'WRITE', required: ['to', 'subject'] }),
            action({ name: 'findEmail', displayName: 'Find Email', description: 'Find an email in the mailbox', classification: 'SEARCH', required: ['query'] }),
        ],
        triggers: [trigger({ name: 'newEmail', displayName: 'New Email', description: 'Triggers when a new email arrives' })],
    },
    {
        name: '@activepieces/piece-telegram-bot',
        displayName: 'Telegram Bot',
        description: 'Build chatbots for Telegram',
        categories: [PieceCategory.COMMUNICATION],
        requiresAuth: true,
        actions: [
            action({ name: 'send_text_message', displayName: 'Send Text Message', description: 'Send a text message to a Telegram chat', classification: 'WRITE', required: ['chat_id', { name: 'message', type: 'LONG_TEXT' }] }),
            action({ name: 'telegram_send_poll', displayName: 'Send Poll', description: 'Send a poll to a Telegram chat', classification: 'WRITE', required: ['chat_id'] }),
        ],
    },
    {
        name: '@activepieces/piece-salesforce',
        displayName: 'Salesforce',
        description: 'Customer relationship management platform',
        categories: [PieceCategory.SALES_AND_CRM],
        requiresAuth: true,
        actions: [
            action({ name: 'run_query', displayName: 'Run Query', description: 'Run a SOQL query against Salesforce', aiDescription: 'Reads records out of Salesforce with a SOQL query.', classification: 'SEARCH', required: [{ name: 'query', type: 'LONG_TEXT' }] }),
        ],
    },
    {
        name: '@activepieces/piece-capsule-crm',
        displayName: 'Capsule CRM',
        description: 'Customer relationship management platform',
        categories: [PieceCategory.SALES_AND_CRM],
        requiresAuth: true,
        actions: [
            action({ name: 'find_contact', displayName: 'Find Contact', description: 'Find a contact in Capsule CRM', aiDescription: 'Looks a contact up in Capsule CRM.', classification: 'SEARCH', required: [{ name: 'searchTerm', type: 'SHORT_TEXT' }] }),
        ],
    },
    {
        name: '@activepieces/piece-slack',
        displayName: 'Slack',
        description: 'Channel-based messaging platform',
        categories: [PieceCategory.COMMUNICATION],
        requiresAuth: true,
        actions: [
            action({ name: 'send_channel_message', displayName: 'Send Message To A Channel', description: 'Send a message to a Slack channel', aiDescription: 'Posts a message into a Slack channel that the whole workspace can read.', classification: 'WRITE', required: [{ name: 'channel', type: 'DROPDOWN' }, { name: 'text', type: 'LONG_TEXT' }] }),
            action({ name: 'send_direct_message', displayName: 'Send Message To A User', description: 'Send a direct message to a Slack user', classification: 'WRITE', required: ['user', 'text'] }),
        ],
    },
    {
        name: '@activepieces/piece-microsoft-teams',
        displayName: 'Microsoft Teams',
        description: '',
        categories: [PieceCategory.COMMUNICATION],
        requiresAuth: true,
        actions: [
            action({ name: 'microsoft_teams_send_channel_message', displayName: 'Send Channel Message', description: 'Send a message to a Teams channel', classification: 'WRITE', required: ['teamId', 'channelId'] }),
            action({ name: 'microsoft_teams_send_chat_message', displayName: 'Send Chat Message', description: 'Send a message to a Teams chat', classification: 'WRITE', required: ['chatId'] }),
        ],
    },
    {
        name: '@activepieces/piece-google-sheets',
        displayName: 'Google Sheets',
        description: 'Create, edit, and collaborate on spreadsheets online',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [
            action({ name: 'insert_row', displayName: 'Add Row', description: 'Append a row of values to a spreadsheet', classification: 'WRITE', required: [{ name: 'spreadsheetId', type: 'DROPDOWN' }, 'values'] }),
            action({ name: 'sheets_find_rows', displayName: 'Find Rows', description: 'Find rows in a spreadsheet', classification: 'SEARCH', required: ['spreadsheetId'] }),
        ],
        triggers: [trigger({ name: 'new_row_added', displayName: 'New Row Added', description: 'Triggers when a new row is added to a spreadsheet' })],
    },
    {
        name: '@activepieces/piece-microsoft-excel-365',
        displayName: 'Microsoft Excel 365',
        description: 'Spreadsheet software by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [
            action({ name: 'append_row', displayName: 'Add Row', description: 'Append a row of values to a worksheet', classification: 'WRITE', required: ['workbookId', 'values'] }),
            action({ name: 'get_worksheet_rows', displayName: 'Get Rows', description: 'Read rows from a worksheet', classification: 'READ', required: ['workbookId'] }),
        ],
    },
    {
        name: '@activepieces/piece-google-drive',
        displayName: 'Google Drive',
        description: 'Cloud storage and file backup',
        categories: [PieceCategory.CONTENT_AND_FILES],
        requiresAuth: true,
        actions: [
            action({ name: 'drive_upload_file', displayName: 'Upload File', description: 'Upload a file to a Drive folder', classification: 'WRITE', required: ['file'] }),
            action({ name: 'list-files', displayName: 'List Files', description: 'List the files in a Drive folder', classification: 'READ', required: ['folderId'] }),
            action({ name: 'drive_trash_file', displayName: 'Trash File', description: 'Move a file to the Drive bin', classification: 'DESTRUCTIVE', required: ['fileId'] }),
            action({ name: 'drive_export_folder_as_zip', displayName: 'Export Folder as Zip', description: 'Export a Drive folder as a zip archive', required: ['folderId'] }),
        ],
    },
    {
        name: '@activepieces/piece-microsoft-onedrive',
        displayName: 'Microsoft OneDrive',
        description: 'Cloud storage by Microsoft',
        categories: [PieceCategory.CONTENT_AND_FILES],
        requiresAuth: true,
        actions: [
            action({ name: 'upload_onedrive_file', displayName: 'Upload File', description: 'Upload a file to a OneDrive folder', classification: 'WRITE', required: ['file'], audience: 'human' }),
            action({ name: 'list_files', displayName: 'List Files', description: 'List the files in a OneDrive folder', classification: 'READ', required: ['folderId'] }),
        ],
    },
    {
        name: '@activepieces/piece-microsoft-dynamics-365-business-central',
        displayName: 'Microsoft Dynamics 365 Business Central',
        description: 'Business management solution by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [action({ name: 'create_sales_order', displayName: 'Create Sales Order', description: 'Create a sales order in Business Central', classification: 'WRITE', required: ['customerId'] })],
    },
    {
        name: '@activepieces/piece-microsoft-sharepoint',
        displayName: 'Microsoft SharePoint',
        description: 'Collaboration platform by Microsoft',
        categories: [PieceCategory.CONTENT_AND_FILES],
        requiresAuth: true,
        actions: [action({ name: 'create_list_item', displayName: 'Create List Item', description: 'Create an item in a SharePoint list', classification: 'WRITE', required: ['siteId'] })],
    },
    {
        name: '@activepieces/piece-microsoft-todo',
        displayName: 'Microsoft To Do',
        description: 'Task management by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [action({ name: 'create_task', displayName: 'Create Task', description: 'Create a task in Microsoft To Do', classification: 'WRITE', required: ['listId'] })],
    },
    {
        name: '@activepieces/piece-microsoft-planner',
        displayName: 'Microsoft Planner',
        description: 'Project planning by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [action({ name: 'create_plan_task', displayName: 'Create Plan Task', description: 'Create a task in a Microsoft Planner plan', classification: 'WRITE', required: ['planId'] })],
    },
    {
        name: '@activepieces/piece-microsoft-forms',
        displayName: 'Microsoft Forms',
        description: 'Survey and form builder by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [action({ name: 'get_form_responses', displayName: 'Get Form Responses', description: 'Read responses from a Microsoft form', classification: 'WRITE', required: ['formId'] })],
    },
    {
        name: '@activepieces/piece-microsoft-outlook-calendar',
        displayName: 'Microsoft Outlook Calendar',
        description: 'Calendar software by Microsoft',
        categories: [PieceCategory.PRODUCTIVITY],
        requiresAuth: true,
        actions: [action({ name: 'create_event', displayName: 'Create Event', description: 'Create an event in the Outlook calendar', classification: 'WRITE', required: ['subject'] })],
    },
]

type ActionSeed = {
    name: string
    displayName: string
    description: string
    aiDescription?: string
    classification?: 'READ' | 'SEARCH' | 'WRITE' | 'DESTRUCTIVE'
    required?: RequiredProp[]
    audience?: 'human' | 'ai' | 'both'
}

type PropSpec = { name: string, type: 'SHORT_TEXT' | 'LONG_TEXT' | 'DROPDOWN' | 'OBJECT' | 'STATIC_DROPDOWN', defaultValue?: string }

type RequiredProp = string | PropSpec

type TriggerSeed = Omit<ActionSeed, 'classification' | 'aiDescription' | 'audience'>

type PieceSeed = {
    name: string
    displayName: string
    description: string
    categories: PieceCategory[]
    requiresAuth: boolean
    actions?: ActionBase[]
    triggers?: TriggerBase[]
}
