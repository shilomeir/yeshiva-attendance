import { useEffect, useMemo, useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  getDay,
} from 'date-fns'
import { he } from 'date-fns/locale'
import { ChevronRight, ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils/cn'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { CalendarDeparture } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:   'ממתין',
  APPROVED:  'מאושר',
  ACTIVE:    'בחוץ',
  COMPLETED: 'חזר',
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  APPROVED:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ACTIVE:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

interface HebrewDateParts {
  day: number
  month: string
  year: string
  label: string
}

interface JewishCalendarInfo {
  hebrewDate: HebrewDateParts
  isShabbat: boolean
  labels: string[]
  shabbatLabel?: string
}

interface DayData {
  date: Date
  exitCount: number
  departures: CalendarDeparture[]
  totalStudents: number
  jewishInfo: JewishCalendarInfo
}

const HEBREW_DATE_FORMATTER = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const SHABBAT_LABEL = 'שבת'
const HEBCAL_ATTRIBUTION_URL = 'https://www.hebcal.com/home/developer-apis'

interface HebcalCalendarEvent {
  date?: string
  category?: string
  hebrew?: string
}

interface HebcalCalendarResponse {
  items?: HebcalCalendarEvent[]
}

const HOLIDAY_BY_MONTH_DAY: Record<string, Record<number, string>> = {
  'תשרי': {
    1: 'ראש השנה',
    2: 'ראש השנה',
    10: 'יום כיפור',
    15: 'סוכות',
    16: 'חול המועד סוכות',
    17: 'חול המועד סוכות',
    18: 'חול המועד סוכות',
    19: 'חול המועד סוכות',
    20: 'חול המועד סוכות',
    21: 'הושענא רבה',
    22: 'שמחת תורה',
  },
  'כסלו': {
    25: 'חנוכה',
    26: 'חנוכה',
    27: 'חנוכה',
    28: 'חנוכה',
    29: 'חנוכה',
    30: 'חנוכה',
  },
  'טבת': {
    1: 'חנוכה',
    2: 'חנוכה',
    3: 'חנוכה',
  },
  'שבט': {
    15: 'ט״ו בשבט',
  },
  'אדר': {
    14: 'פורים',
    15: 'שושן פורים',
  },
  'אדר ב׳': {
    14: 'פורים',
    15: 'שושן פורים',
  },
  'ניסן': {
    15: 'פסח',
    16: 'חול המועד פסח',
    17: 'חול המועד פסח',
    18: 'חול המועד פסח',
    19: 'חול המועד פסח',
    20: 'חול המועד פסח',
    21: 'שביעי של פסח',
  },
  'אייר': {
    18: 'ל״ג בעומר',
  },
  'סיוון': {
    6: 'שבועות',
  },
  'אב': {
    15: 'ט״ו באב',
  },
}

function getHebrewDateParts(date: Date): HebrewDateParts {
  const parts = HEBREW_DATE_FORMATTER.formatToParts(date)
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '0')
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const year = parts.find((part) => part.type === 'year')?.value ?? ''

  return {
    day,
    month,
    year,
    label: [day || '', month].filter(Boolean).join(' '),
  }
}

function getJewishCalendarInfo(date: Date): JewishCalendarInfo {
  const hebrewDate = getHebrewDateParts(date)
  const labels: string[] = []
  const holiday = HOLIDAY_BY_MONTH_DAY[hebrewDate.month]?.[hebrewDate.day]
  const isRoshChodesh = hebrewDate.day === 1 || hebrewDate.day === 30
  const isShabbat = getDay(date) === 6

  if (isShabbat) labels.push(SHABBAT_LABEL)
  if (holiday) labels.push(holiday)
  if (isRoshChodesh && holiday !== 'ראש השנה') labels.push('ראש חודש')

  return { hebrewDate, isShabbat, labels }
}

function normalizeParshaLabel(hebrewTitle: string | undefined): string | null {
  if (!hebrewTitle) return null
  const parsha = hebrewTitle
    .replace(/^פרשת\s+/, '')
    .replace(/[־–—]/g, '-')
    .trim()

  return parsha ? `${SHABBAT_LABEL} ${parsha}` : null
}

function withShabbatLabel(info: JewishCalendarInfo, shabbatLabel: string | undefined): JewishCalendarInfo {
  if (!info.isShabbat || !shabbatLabel) return info

  return {
    ...info,
    shabbatLabel,
    labels: info.labels.map((label) => label === SHABBAT_LABEL ? shabbatLabel : label),
  }
}

function getParshaCacheKey(month: Date): string {
  return `parsha:${format(month, 'yyyy-MM')}`
}

function readCachedParshaMap(cacheKey: string): Map<string, string> | null {
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (!cached) return null

    const entries = JSON.parse(cached) as Array<[string, string]>
    return new Map(entries)
  } catch {
    return null
  }
}

function writeCachedParshaMap(cacheKey: string, map: Map<string, string>) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(Array.from(map.entries())))
  } catch {
    // Calendar display should never depend on storage availability.
  }
}

async function fetchParshaByDate(month: Date): Promise<Map<string, string>> {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const params = new URLSearchParams({
    v: '1',
    cfg: 'json',
    start: format(monthStart, 'yyyy-MM-dd'),
    end: format(monthEnd, 'yyyy-MM-dd'),
    i: 'on',
    s: 'on',
    leyning: 'off',
    lg: 'he',
  })

  const response = await fetch(`https://www.hebcal.com/hebcal?${params.toString()}`)
  if (!response.ok) throw new Error(`Hebcal calendar request failed: ${response.status}`)

  const data = await response.json() as HebcalCalendarResponse
  const map = new Map<string, string>()

  for (const item of data.items ?? []) {
    if (item.category !== 'parashat' || !item.date) continue
    const label = normalizeParshaLabel(item.hebrew)
    if (label) map.set(item.date.slice(0, 10), label)
  }

  return map
}

export function AbsenceCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [dayData, setDayData] = useState<Map<string, DayData>>(new Map())
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null)
  const [totalStudents, setTotalStudents] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [parshaByDate, setParshaByDate] = useState<Map<string, string>>(new Map())

  const loadData = async () => {
    setIsLoading(true)
    try {
      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)
      const monthStartStr = format(monthStart, 'yyyy-MM-dd')
      const monthEndStr   = format(monthEnd, 'yyyy-MM-dd')

      // Fetch a generous window: departures starting from a month before so multi-day
      // departures that started before the month are captured.
      const fromDate = new Date(monthStart)
      fromDate.setMonth(fromDate.getMonth() - 1)

      const [allDeps, stats] = await Promise.all([
        api.listDepartures({ from: fromDate }),
        api.getDashboardStats(),
      ])

      const total = stats.total
      setTotalStudents(total)

      const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
      const newDayData = new Map<string, DayData>()

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayDeps = allDeps.filter((d) => {
          const depStart = d.start_at.slice(0, 10)
          const depEnd   = d.end_at.slice(0, 10)
          return depStart <= dateStr && depEnd >= dateStr
        })
        // Also ensure departure overlaps the selected month
        if (dateStr >= monthStartStr && dateStr <= monthEndStr) {
          newDayData.set(dateStr, {
            date: day,
            exitCount: dayDeps.length,
            departures: dayDeps,
            totalStudents: total,
            jewishInfo: getJewishCalendarInfo(day),
          })
        }
      }

      setDayData(newDayData)
    } catch (err) {
      console.error('Failed to load calendar data:', err)
      toast({ title: 'שגיאה בטעינת לוח היעדרויות', description: getErrorMessage(err, 'טעינת נתוני לוח ההיעדרויות נכשלה'), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadData() }, [currentMonth])

  useEffect(() => {
    let cancelled = false
    const cacheKey = getParshaCacheKey(currentMonth)
    const cached = readCachedParshaMap(cacheKey)

    if (cached) {
      setParshaByDate(cached)
      return () => { cancelled = true }
    }

    setParshaByDate(new Map())

    fetchParshaByDate(currentMonth)
      .then((map) => {
        writeCachedParshaMap(cacheKey, map)
        if (!cancelled) setParshaByDate(map)
      })
      .catch((err) => {
        console.warn('Failed to load Hebrew parsha data:', err)
        if (!cancelled) setParshaByDate(new Map())
      })

    return () => { cancelled = true }
  }, [currentMonth])

  useDeparturesRealtime({ onAnyChange: loadData })

  const days = useMemo(() => eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  }), [currentMonth])

  const jewishInfoByDate = useMemo(() => {
    const map = new Map<string, JewishCalendarInfo>()
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      map.set(dateStr, withShabbatLabel(getJewishCalendarInfo(day), parshaByDate.get(dateStr)))
    }
    return map
  }, [days, parshaByDate])

  const selectedJewishInfo = selectedDay
    ? withShabbatLabel(
        selectedDay.jewishInfo,
        parshaByDate.get(format(selectedDay.date, 'yyyy-MM-dd'))
      )
    : null

  const firstDayOfWeek = getDay(startOfMonth(currentMonth))

  const getDayColor = (data: DayData | undefined): string => {
    if (!data || data.exitCount === 0) return ''
    const pct = (data.exitCount / data.totalStudents) * 100
    if (pct < 5) return 'bg-green-100 text-green-800 dark:bg-green-900/30'
    if (pct < 15) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30'
    return 'bg-red-100 text-red-800 dark:bg-red-900/30'
  }

  const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold text-[var(--text)]">
          {format(currentMonth, 'MMMM yyyy', { locale: he })}
        </h2>
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-green-200 dark:bg-green-800" />פחות מ-5%</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-yellow-200 dark:bg-yellow-800" />5-15%</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-200 dark:bg-red-800" />מעל 15%</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200 dark:bg-slate-600" />שבת / פרשה</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-sky-100 dark:bg-sky-900 ring-1 ring-sky-200 dark:ring-sky-700" />חגים וראש חודש</span>
        <a
          className="underline-offset-2 hover:underline"
          href={HEBCAL_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
        >
          פרשות: Hebcal
        </a>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)]">
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
              {day}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            טוען נתונים...
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="border-b border-e border-[var(--border)] p-2 min-h-[70px]" />
            ))}

            {days.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const data = dayData.get(dateStr)
              const jewishInfo = data?.jewishInfo
                ? withShabbatLabel(data.jewishInfo, parshaByDate.get(dateStr))
                : jewishInfoByDate.get(dateStr) ?? getJewishCalendarInfo(day)
              const dayColor = getDayColor(data)

              return (
                <div
                  key={dateStr}
                  className={cn(
                    'relative cursor-pointer border-b border-e border-[var(--border)] p-2 min-h-[82px] transition-all hover:opacity-80',
                    dayColor,
                    jewishInfo.isShabbat && 'border-t-2 border-t-slate-400 dark:border-t-slate-500',
                    !isSameMonth(day, currentMonth) && 'opacity-30'
                  )}
                  onClick={() => setSelectedDay(data ?? null)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-medium">{format(day, 'd')}</span>
                    <span className="truncate text-[10px] leading-4 text-[var(--text-muted)]" title={`${jewishInfo.hebrewDate.label} ${jewishInfo.hebrewDate.year}`}>
                      {jewishInfo.hebrewDate.label}
                    </span>
                  </div>
                  {jewishInfo.labels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {jewishInfo.labels.slice(0, 2).map((label) => (
                        <span
                          key={label}
                          className={cn(
                            'max-w-full truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-3',
                            label.startsWith(SHABBAT_LABEL)
                              ? 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-100'
                              : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
                          )}
                          title={label}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  {data && data.exitCount > 0 && (
                    <div className="mt-1">
                      <span className="text-xs font-bold">{data.exitCount}</span>
                      <span className="text-xs"> יציאות</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Day detail panel */}
      {selectedDay && selectedJewishInfo && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-[var(--text)]">
                  {format(selectedDay.date, 'EEEE, d בMMMM', { locale: he })}
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  {selectedJewishInfo.hebrewDate.label} {selectedJewishInfo.hebrewDate.year}
                  {selectedJewishInfo.labels.length > 0 && ` · ${selectedJewishInfo.labels.join(' · ')}`}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  {selectedDay.exitCount} יציאות
                  {selectedDay.totalStudents > 0 && ` (${((selectedDay.exitCount / selectedDay.totalStudents) * 100).toFixed(1)}%)`}
                </p>
              </div>
              <button onClick={() => setSelectedDay(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedDay.departures.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">אין יציאות ביום זה</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedDay.departures.map((dep) => (
                  <div key={dep.id} className="rounded-lg bg-[var(--bg-2)] p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-[var(--text)]">{dep.student_name}</p>
                          {dep.is_urgent && (
                            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                              חריג
                            </span>
                          )}
                        </div>
                        {(dep.grade || dep.class_id) && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {dep.grade}{dep.grade && dep.class_id ? ' · ' : ''}{dep.class_id}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">
                          {getTimeStr(dep.start_at)}–{getTimeStr(dep.end_at)}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[dep.status] ?? ''}`}>
                          {STATUS_LABEL[dep.status] ?? dep.status}
                        </span>
                      </div>
                    </div>
                    {dep.reason && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{dep.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
