import type { EventType } from '@/types'

export interface ParsedSms {
  type: EventType
  time: string | null
  reason: string | null
}

// Hebrew SMS format:
// Departure: יציאה HH:MM [reason]
// Return: חזרה
const DEPARTURE_REGEX = /^יציאה\s+(\d{1,2}:\d{2})\s+(.+)$/
const SIMPLE_DEPARTURE_REGEX = /^יציאה\s+(\d{1,2}:\d{2})$/
const RETURN_REGEX = /^חזרה$/

export function parseSmsMessage(raw: string): ParsedSms | null {
  const trimmed = raw.trim()

  // Check for return
  if (RETURN_REGEX.test(trimmed)) {
    return {
      type: 'CHECK_IN',
      time: null,
      reason: null,
    }
  }

  // Check for departure with reason
  const departureMatch = DEPARTURE_REGEX.exec(trimmed)
  if (departureMatch) {
    return {
      type: 'CHECK_OUT',
      time: departureMatch[1],
      reason: departureMatch[2].trim(),
    }
  }

  // Check for departure without reason
  const simpleDepartureMatch = SIMPLE_DEPARTURE_REGEX.exec(trimmed)
  if (simpleDepartureMatch) {
    return {
      type: 'CHECK_OUT',
      time: simpleDepartureMatch[1],
      reason: null,
    }
  }

  return null
}

export function formatSmsForDisplay(parsed: ParsedSms): string {
  if (parsed.type === 'CHECK_IN') {
    return 'חזרה לישיבה'
  }

  let msg = `יציאה`
  if (parsed.time) msg += ` בשעה ${parsed.time}`
  if (parsed.reason) msg += ` - ${parsed.reason}`
  return msg
}
