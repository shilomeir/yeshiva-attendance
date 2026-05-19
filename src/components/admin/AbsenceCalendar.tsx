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

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  PENDING:   { bg: 'var(--warn-soft)',  text: 'var(--warn)' },
  APPROVED:  { bg: 'var(--info-soft)',  text: 'var(--info)' },
  ACTIVE:    { bg: 'var(--warn-soft)',  text: 'var(--warn)' },
  COMPLETED: { bg: 'var(--good-soft)',  text: 'var(--good)' },
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
  'תשרי': { 1: 'ראש השנה', 2: 'ראש השנה', 10: 'יום כיפור', 15: 'סוכות', 16: 'חול המועד סוכות', 17: 'חול המועד סוכות', 18: 'חול המועד סוכות', 19: 'חול המועד סוכות', 20: 'חול המועד סוכות', 21: 'הושענא רבה', 22: 'שמחת תורה' },
  'כסלו': { 25: 'חנוכה', 26: 'חנוכה', 27: 'חנוכה', 28: 'חנוכה', 29: 'חנוכה', 30: 'חנוכה' },
  'טבת':  { 1: 'חנוכה', 2: 'חנוכה', 3: 'חנוכה' },
  'שבט':  { 15: 'ט״ו בשבט' },
  'אדר':  { 14: 'פורים', 15: 'שושן פורים' },
  'אדר ב׳': { 14: 'פורים', 15: 'שושן פורים' },
  'ניסן': { 15: 'פסח', 16: 'חול המועד פסח', 17: 'חול המועד פסח', 18: 'חול המועד פסח', 19: 'חול המועד פסח', 20: 'חול המועד פסח', 21: 'שביעי של פסח' },
  'אייר': { 18: 'ל״ג בעומר' },
  'סיוון': { 6: 'שבועות' },
  'אב':   { 15: 'ט״ו באב' },
}

function getHebrewDateParts(date: Date): HebrewDateParts {
  const parts = HEBREW_DATE_FORMATTER.formatToParts(date)
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '0')
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  return { day, month, year, label: [day || '', month].filter(Boolean).join(' ') }
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
  const parsha = hebrewTitle.replace(/^פרשת\s+/, '').replace(/[־–—]/g, '-').trim()
  return parsha ? `${SHABBAT_LABEL} ${parsha}` : null
}

function withShabbatLabel(info: JewishCalendarInfo, shabbatLabel: string | undefined): JewishCalendarInfo {
  if (!info.isShabbat || !shabbatLabel) return info
  return { ...info, shabbatLabel, labels: info.labels.map((label) => label === SHABBAT_LABEL ? shabbatLabel : label) }
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
  } catch { return null }
}

function writeCachedParshaMap(cacheKey: string, map: Map<string, string>) {
  try { sessionStorage.setItem(cacheKey, JSON.stringify(Array.from(map.entries()))) } catch { /* ignore */ }
}

async function fetchParshaByDate(month: Date): Promise<Map<string, string>> {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const params = new URLSearchParams({ v: '1', cfg: 'json', start: format(monthStart, 'yyyy-MM-dd'), end: format(monthEnd, 'yyyy-MM-dd'), i: 'on', s: 'on', leyning: 'off', lg: 'he' })
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
        if (dateStr >= monthStartStr && dateStr <= monthEndStr) {
          newDayData.set(dateStr, { date: day, exitCount: dayDeps.length, departures: dayDeps, totalStudents: total, jewishInfo: getJewishCalendarInfo(day) })
        }
      }

      setDayData(newDayData)
    } catch (err) {
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
    if (cached) { setParshaByDate(cached); return () => { cancelled = true } }
    setParshaByDate(new Map())
    fetchParshaByDate(currentMonth)
      .then((map) => { writeCachedParshaMap(cacheKey, map); if (!cancelled) setParshaByDate(map) })
      .catch((err) => { console.warn('Failed to load Hebrew parsha data:', err); if (!cancelled) setParshaByDate(new Map()) })
    return () => { cancelled = true }
  }, [currentMonth])

  useDeparturesRealtime({ onAnyChange: loadData })

  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) }), [currentMonth])

  const jewishInfoByDate = useMemo(() => {
    const map = new Map<string, JewishCalendarInfo>()
    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      map.set(dateStr, withShabbatLabel(getJewishCalendarInfo(day), parshaByDate.get(dateStr)))
    }
    return map
  }, [days, parshaByDate])

  const selectedJewishInfo = selectedDay
    ? withShabbatLabel(selectedDay.jewishInfo, parshaByDate.get(format(selectedDay.date, 'yyyy-MM-dd')))
    : null

  const firstDayOfWeek = getDay(startOfMonth(currentMonth))

  const getDayColor = (data: DayData | undefined) => {
    if (!data || data.exitCount === 0) return { bg: 'transparent', text: 'var(--ink)' }
    const pct = (data.exitCount / data.totalStudents) * 100
    if (pct < 5)  return { bg: 'var(--good-soft)',  text: 'var(--good)' }
    if (pct < 15) return { bg: 'var(--warn-soft)',   text: 'var(--warn)' }
    return { bg: 'var(--bad-soft)', text: 'var(--bad)' }
  }

  const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

  const navBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8,
    border: '1px solid var(--hairline)',
    background: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center',
    color: 'var(--ink-muted)',
  }

  const navBtnSm: React.CSSProperties = {
    padding: '6px 12px', borderRadius: 8,
    border: '1px solid var(--hairline)',
    background: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
    color: 'var(--ink)', fontFamily: 'inherit',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

      {/* ── Calendar grid ───────────────────────────────────────────── */}
      <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>

        {/* Calendar header with nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--hairline)' }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
            {format(currentMonth, 'MMMM yyyy', { locale: he })}
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={navBtn} onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button style={navBtnSm} onClick={() => setCurrentMonth(new Date())}>היום</button>
            <button style={navBtn} onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--hairline)', display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11.5, color: 'var(--ink-muted)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--good-soft)', border: '1px solid var(--good)33', display: 'inline-block' }} />
            פחות מ-5%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--warn-soft)', border: '1px solid var(--warn)33', display: 'inline-block' }} />
            5-15%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--bad-soft)', border: '1px solid var(--bad)33', display: 'inline-block' }} />
            מעל 15%
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(100,116,139,0.15)', display: 'inline-block' }} />
            שבת / פרשה
          </span>
          <a href={HEBCAL_ATTRIBUTION_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', marginInlineStart: 'auto', fontSize: 11 }}>
            פרשות: Hebcal
          </a>
        </div>

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--hairline)' }}>
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--ink-faint)', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' }}>
              {day}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, color: 'var(--ink-faint)' }}>
            טוען נתונים...
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} style={{ minHeight: 82, borderBottom: '1px solid var(--hairline)', borderInlineEnd: '1px solid var(--hairline)', background: 'rgba(20,18,25,0.015)' }} />
            ))}

            {days.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const data = dayData.get(dateStr)
              const jewishInfo = data?.jewishInfo
                ? withShabbatLabel(data.jewishInfo, parshaByDate.get(dateStr))
                : jewishInfoByDate.get(dateStr) ?? getJewishCalendarInfo(day)
              const dayColor = getDayColor(data)
              const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr

              return (
                <div
                  key={dateStr}
                  onClick={() => setSelectedDay(data ?? null)}
                  style={{
                    minHeight: 82, padding: 8, cursor: 'pointer',
                    borderBottom: '1px solid var(--hairline)',
                    borderInlineEnd: '1px solid var(--hairline)',
                    background: isToday ? 'rgba(79,70,229,0.05)' : jewishInfo.isShabbat ? 'rgba(100,116,139,0.04)' : (data?.exitCount ? dayColor.bg + '80' : 'transparent'),
                    transition: 'opacity 0.14s',
                    opacity: isSameMonth(day, currentMonth) ? 1 : 0.35,
                    borderTop: jewishInfo.isShabbat ? '2px solid rgba(100,116,139,0.25)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{
                      fontSize: 12, fontWeight: isToday ? 700 : 500,
                      width: 22, height: 22, lineHeight: '22px', textAlign: 'center', borderRadius: 6,
                      background: isToday ? 'var(--accent)' : 'transparent',
                      color: isToday ? 'white' : 'var(--ink)',
                    }}>
                      {format(day, 'd')}
                    </span>
                    <span style={{ fontSize: 9.5, color: 'var(--ink-faint)', maxWidth: 50, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {jewishInfo.hebrewDate.label}
                    </span>
                  </div>

                  {jewishInfo.labels.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 2 }}>
                      {jewishInfo.labels.slice(0, 2).map((label) => (
                        <span key={label} style={{
                          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          padding: '1px 4px', borderRadius: 4, fontSize: 9,
                          background: label.startsWith(SHABBAT_LABEL) ? 'rgba(100,116,139,0.15)' : 'var(--info-soft)',
                          color: label.startsWith(SHABBAT_LABEL) ? 'rgba(71,85,105,0.8)' : 'var(--info)',
                        }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  {data && data.exitCount > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: dayColor.text }}>
                      {data.exitCount} יציאות
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Day detail panel ──────────────────────────────────────────── */}
      {selectedDay && selectedJewishInfo && (
        <div className="glass" style={{ padding: 'var(--card-pad)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
                {format(selectedDay.date, 'EEEE, d בMMMM', { locale: he })}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 }}>
                {selectedJewishInfo.hebrewDate.label} {selectedJewishInfo.hebrewDate.year}
                {selectedJewishInfo.labels.length > 0 && ` · ${selectedJewishInfo.labels.join(' · ')}`}
              </p>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                {selectedDay.exitCount} יציאות
                {selectedDay.totalStudents > 0 && ` (${((selectedDay.exitCount / selectedDay.totalStudents) * 100).toFixed(1)}%)`}
              </p>
            </div>
            <button
              onClick={() => setSelectedDay(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 6, borderRadius: 8 }}
            >
              <X size={16} />
            </button>
          </div>

          {selectedDay.departures.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>אין יציאות ביום זה</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedDay.departures.map((dep) => {
                const sc = STATUS_COLOR[dep.status] ?? { bg: 'var(--bg-2)', text: 'var(--ink-muted)' }
                return (
                  <div key={dep.id} style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.55)', border: '1px solid var(--hairline)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <p style={{ fontWeight: 500, fontSize: 14, color: 'var(--ink)', margin: 0 }}>{dep.student_name}</p>
                          {dep.is_urgent && (
                            <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 10.5, fontWeight: 700 }}>חריג</span>
                          )}
                        </div>
                        {(dep.grade || dep.class_id) && (
                          <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>
                            {dep.grade}{dep.grade && dep.class_id ? ' · ' : ''}{dep.class_id}
                          </p>
                        )}
                        {dep.reason && (
                          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>{dep.reason}</p>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <span className="font-mono-num" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                          {getTimeStr(dep.start_at)}–{getTimeStr(dep.end_at)}
                        </span>
                        <span style={{ padding: '3px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: sc.bg, color: sc.text }}>
                          {STATUS_LABEL[dep.status] ?? dep.status}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
