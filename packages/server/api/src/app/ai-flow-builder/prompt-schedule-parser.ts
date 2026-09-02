const DAYS_OF_WEEK: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
}

const DEFAULT_HOUR = 9
const DEFAULT_TIMEZONE = 'UTC'

export const promptScheduleParser = {
    parse({ prompt }: { prompt: string }): ParsedSchedule | null {
        const text = prompt.toLowerCase()

        const everyMinutes = matchInterval({ text, unit: 'minute' })
        if (everyMinutes !== null) {
            return build({ cronExpression: `*/${everyMinutes} * * * *`, description: `every ${everyMinutes} minutes` })
        }

        const everyHours = matchInterval({ text, unit: 'hour' })
        if (everyHours !== null) {
            return build({ cronExpression: `0 */${everyHours} * * *`, description: `every ${everyHours} hours` })
        }

        if (/\b(every|each)\s+hour\b|\bhourly\b/.test(text)) {
            return build({ cronExpression: '0 * * * *', description: 'every hour' })
        }

        const timeOfDay = matchTimeOfDay({ text })
        const hour = timeOfDay?.hour ?? DEFAULT_HOUR
        const minute = timeOfDay?.minute ?? 0
        const at = formatTime({ hour, minute })

        const weekday = matchWeekday({ text })
        if (weekday !== null) {
            return build({ cronExpression: `${minute} ${hour} * * ${weekday.index}`, description: `every ${weekday.name} at ${at}` })
        }

        const dayOfMonth = matchDayOfMonth({ text })
        if (dayOfMonth !== null) {
            return build({ cronExpression: `${minute} ${hour} ${dayOfMonth} * *`, description: `on day ${dayOfMonth} of every month at ${at}` })
        }

        if (/\b(every|each)\s+month\b|\bmonthly\b/.test(text)) {
            return build({ cronExpression: `${minute} ${hour} 1 * *`, description: `on day 1 of every month at ${at}` })
        }

        if (/\b(every|each)\s+week\b|\bweekly\b/.test(text)) {
            return build({ cronExpression: `${minute} ${hour} * * 1`, description: `every monday at ${at}` })
        }

        if (/\b(every|each)\s+day\b|\bdaily\b|\bevery\s+morning\b|\bevery\s+night\b/.test(text)) {
            return build({ cronExpression: `${minute} ${hour} * * *`, description: `every day at ${at}` })
        }

        if (timeOfDay !== null) {
            return build({ cronExpression: `${minute} ${hour} * * *`, description: `every day at ${at}` })
        }

        return null
    },
}

function build({ cronExpression, description }: { cronExpression: string, description: string }): ParsedSchedule {
    return { cronExpression, timezone: DEFAULT_TIMEZONE, description }
}

function matchInterval({ text, unit }: { text: string, unit: 'minute' | 'hour' }): number | null {
    const match = new RegExp(`\\b(?:every|each)\\s+(\\d+)\\s*${unit}s?\\b`).exec(text)
    if (match === null) {
        return null
    }
    const value = Number.parseInt(match[1], 10)
    const max = unit === 'minute' ? 59 : 23
    if (Number.isNaN(value) || value < 1 || value > max) {
        return null
    }
    return value
}

function matchTimeOfDay({ text }: { text: string }): TimeOfDay | null {
    const explicit = /\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text)
    if (explicit !== null) {
        const parsed = normalizeHour({ rawHour: Number.parseInt(explicit[1], 10), minute: explicit[2], meridiem: explicit[3] })
        if (parsed !== null) {
            return parsed
        }
    }
    const bare = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(text)
    if (bare !== null) {
        return normalizeHour({ rawHour: Number.parseInt(bare[1], 10), minute: bare[2], meridiem: bare[3] })
    }
    return null
}

function normalizeHour({ rawHour, minute, meridiem }: { rawHour: number, minute: string | undefined, meridiem: string | undefined }): TimeOfDay | null {
    if (Number.isNaN(rawHour)) {
        return null
    }
    const minutes = minute === undefined ? 0 : Number.parseInt(minute, 10)
    if (Number.isNaN(minutes) || minutes > 59) {
        return null
    }
    let hour = rawHour
    if (meridiem === 'pm' && hour < 12) {
        hour += 12
    }
    if (meridiem === 'am' && hour === 12) {
        hour = 0
    }
    if (hour > 23) {
        return null
    }
    return { hour, minute: minutes }
}

function matchWeekday({ text }: { text: string }): Weekday | null {
    for (const [name, index] of Object.entries(DAYS_OF_WEEK)) {
        if (new RegExp(`\\b${name}s?\\b`).test(text)) {
            return { name, index }
        }
    }
    return null
}

function matchDayOfMonth({ text }: { text: string }): number | null {
    const match = /\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text)
    if (match === null) {
        return null
    }
    const day = Number.parseInt(match[1], 10)
    if (Number.isNaN(day) || day < 1 || day > 31) {
        return null
    }
    return day
}

function formatTime({ hour, minute }: { hour: number, minute: number }): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

type TimeOfDay = {
    hour: number
    minute: number
}

type Weekday = {
    name: string
    index: number
}

export type ParsedSchedule = {
    cronExpression: string
    timezone: string
    description: string
}
