export function formatTimeHebrew(isoString: string | null): string {
  if (!isoString) return 'לא ידוע'
  const date = new Date(isoString)
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateHebrew(isoString: string | null): string {
  if (!isoString) return 'לא ידוע'
  const date = new Date(isoString)
  return date.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatDateTimeHebrew(isoString: string | null): string {
  if (!isoString) return 'לא ידוע'
  const date = new Date(isoString)
  return date.toLocaleString('he-IL', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'לא ידוע'
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'עכשיו'
  if (diffMins < 60) return `לפני ${diffMins} דקות`
  if (diffHours < 24) return `לפני ${diffHours} שעות`
  if (diffDays === 1) return 'אתמול'
  if (diffDays < 7) return `לפני ${diffDays} ימים`
  return formatDateHebrew(isoString)
}

export function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const diffMs = end.getTime() - start.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60

  if (hours === 0) return `${mins} דקות`
  if (mins === 0) return `${hours} שעות`
  return `${hours} שעות ו-${mins} דקות`
}

export function formatShortDate(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'numeric',
  })
}

export function getDayOfWeekHebrew(dayIndex: number): string {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  return days[dayIndex] ?? ''
}
