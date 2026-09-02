import { promptScheduleParser } from '../../../../src/app/ai-flow-builder/prompt-schedule-parser'

describe('promptScheduleParser', () => {
    describe('daily schedules', () => {
        it.each([
            ['Every day at 7 AM send me the gold price', '0 7 * * *'],
            ['every day at 7am send me the gold price', '0 7 * * *'],
            ['every day at 7:30 am email me', '30 7 * * *'],
            ['every day at 7 pm email me', '0 19 * * *'],
            ['daily at 18:45 post a summary', '45 18 * * *'],
            ['every day send me a digest', '0 9 * * *'],
            ['every morning ping me', '0 9 * * *'],
        ])('parses %s', (prompt, expected) => {
            expect(promptScheduleParser.parse({ prompt })?.cronExpression).toBe(expected)
        })

        it('treats 12 am as midnight', () => {
            expect(promptScheduleParser.parse({ prompt: 'every day at 12 am' })?.cronExpression).toBe('0 0 * * *')
        })

        it('leaves 12 pm as noon', () => {
            expect(promptScheduleParser.parse({ prompt: 'every day at 12 pm' })?.cronExpression).toBe('0 12 * * *')
        })
    })

    describe('intervals', () => {
        it.each([
            ['every 15 minutes check the feed', '*/15 * * * *'],
            ['every 5 minute poll', '*/5 * * * *'],
            ['every 2 hours sync', '0 */2 * * *'],
            ['every hour sync', '0 * * * *'],
            ['hourly sync', '0 * * * *'],
        ])('parses %s', (prompt, expected) => {
            expect(promptScheduleParser.parse({ prompt })?.cronExpression).toBe(expected)
        })

        it('rejects an out-of-range minute interval', () => {
            expect(promptScheduleParser.parse({ prompt: 'every 90 minutes sync' })?.cronExpression).not.toBe('*/90 * * * *')
        })
    })

    describe('weekly and monthly', () => {
        it.each([
            ['every Monday at 9 send the report', '0 9 * * 1'],
            ['every friday at 5 pm wrap up', '0 17 * * 5'],
            ['on sundays at 8am', '0 8 * * 0'],
            ['every week send a recap', '0 9 * * 1'],
            ['weekly recap at 10', '0 10 * * 1'],
            ['every month at 8 send an invoice', '0 8 1 * *'],
            ['monthly report', '0 9 1 * *'],
            ['on the 15th at 6 am send payroll', '0 6 15 * *'],
        ])('parses %s', (prompt, expected) => {
            expect(promptScheduleParser.parse({ prompt })?.cronExpression).toBe(expected)
        })
    })

    describe('no schedule', () => {
        it.each([
            'when a new row is added to my sheet, post it to slack',
            'send me a message',
            '',
        ])('returns null for %s', (prompt) => {
            expect(promptScheduleParser.parse({ prompt })).toBeNull()
        })
    })

    it('defaults the timezone to UTC', () => {
        expect(promptScheduleParser.parse({ prompt: 'every day at 7 am' })?.timezone).toBe('UTC')
    })

    it('describes what it inferred', () => {
        expect(promptScheduleParser.parse({ prompt: 'every day at 7 am' })?.description).toBe('every day at 07:00')
    })
})
