/**
 * Israel date utilities (Asia/Jerusalem timezone).
 * All server-side timestamps are TIMESTAMPTZ; this module helps
 * format/parse them consistently for display in the UI.
 */

const TZ = 'Asia/Jerusalem'

/** Returns the current date in Israel timezone as a YYYY-MM-DD string. */
export function todayIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** Format a UTC timestamp for display in Israel local time. */
export function formatIsrael(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false },
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('he-IL', { timeZone: TZ, ...options }).format(d)
}

/**
 * Build a full TIMESTAMPTZ string for Asia/Jerusalem.
 * Given a YYYY-MM-DD date and HH:MM time string, returns an ISO string in UTC.
 */
export function buildIsraelTimestamp(dateStr: string, timeStr: string): string {
  // Parse as local Israel time by constructing a string the browser can interpret
  const localStr = `${dateStr}T${timeStr}:00`
  // Use Intl to find the UTC offset for this moment in Israel timezone
  const tempDate = new Date(localStr)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(tempDate).map(({ type, value }) => [type, value])
  )
  const localIso = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  const utcOffset = (tempDate.getTime() - new Date(localIso + 'Z').getTime())
  return new Date(tempDate.getTime() - utcOffset).toISOString()
}

/** Returns true if the given timestamp is in the past (UTC comparison). */
export function isPast(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.getTime() < Date.now()
}
