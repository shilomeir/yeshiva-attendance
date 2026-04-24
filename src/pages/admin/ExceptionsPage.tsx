import { useEffect, useState, useCallback, useRef } from 'react'
import {
  AlertOctagon, Phone, User, Clock, CheckCircle, AlertTriangle, ShieldCheck,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import type { Student, CalendarDeparture, DailyPresenceData } from '@/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return 'לא ידוע'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `לפני ${diffMins} דקות`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `לפני ${diffHours} שעות`
  const diffDays = Math.floor(diffHours / 24)
  return `לפני ${diffDays} ימים`
}

function fmt2(n: number) { return n.toString().padStart(2, '0') }
function fmtTime(d: Date) { return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}` }
function fmtMinsLeft(ms: number) {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} דק'`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}ש' ${fmt2(m)}ד'`
}

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const HE_DAYS_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

// ─── types ───────────────────────────────────────────────────────────────────

interface CategorisedStudents {
  noApproval: Student[]
  withApproval: Student[]
  withUrgent: Student[]
}

interface DepartureInfo {
  student: Student
  departedAt: Date
  expectedReturn: Date | null
  variant: 'noApproval' | 'withApproval' | 'withUrgent'
}

interface WeeklyPoint {
  day: string       // short Hebrew day name
  dayFull: string   // full Hebrew day name
  thisWeek: number
  lastWeek: number
  date: string      // YYYY-MM-DD of this-week date
}

// ─── DepartureTimeline ───────────────────────────────────────────────────────

function DepartureTimeline({ items, now }: { items: DepartureInfo[]; now: Date }) {
  if (items.length === 0) return null

  const nowMs = now.getTime()

  // Build time window: 30 min before earliest departure → 30 min after latest expected return
  const departureTimes = items.map(i => i.departedAt.getTime())
  const returnTimes    = items.map(i => i.expectedReturn?.getTime() ?? nowMs + 2 * 3600_000)
  const windowStart    = new Date(Math.min(...departureTimes) - 30 * 60_000)
  const windowEnd      = new Date(Math.max(Math.max(...returnTimes) + 30 * 60_000, nowMs + 60 * 60_000))
  const windowDur      = windowEnd.getTime() - windowStart.getTime()

  const pct = (ms: number) =>
    Math.max(0, Math.min(100, ((ms - windowStart.getTime()) / windowDur) * 100))

  const nowPct = pct(nowMs)

  // Hour ticks for the ruler
  const ticks: Date[] = []
  const t = new Date(windowStart)
  t.setMinutes(0, 0, 0)
  if (t <= windowStart) t.setHours(t.getHours() + 1)
  while (t <= windowEnd) {
    ticks.push(new Date(t))
    t.setHours(t.getHours() + 1)
  }

  return (
    <div
      className="overflow-hidden rounded-2xl animate-slide-up"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: 'rgba(239,68,68,0.1)' }}>
            <Clock className="h-4 w-4 text-[var(--red)]" />
            <span
              className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[var(--red)]"
              style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
            />
          </div>
          <div>
            <p className="text-base font-bold text-[var(--text)]">לוח יציאות — עכשיו</p>
            <p className="text-xs text-[var(--text-muted)]">{items.length} תלמידים מחוץ לישיבה</p>
          </div>
        </div>
        <span
          className="font-mono text-sm font-semibold tabular-nums text-[var(--text-muted)]"
          style={{ letterSpacing: '0.05em' }}
        >
          {fmtTime(now)}
        </span>
      </div>

      {/* ── Timeline grid ── */}
      <div className="overflow-x-auto px-4 pb-4 pt-2" style={{ minWidth: 0 }}>
        <div style={{ minWidth: '480px' }}>

          {/* ── Ruler row ── */}
          <div className="flex items-end gap-3 mb-1">
            {/* Name column spacer */}
            <div className="shrink-0" style={{ width: '9rem' }} />

            {/* Ruler area */}
            <div className="relative flex-1 h-7">
              {/* Baseline */}
              <div
                className="absolute bottom-0 inset-x-0 h-px"
                style={{ background: 'var(--border)' }}
              />
              {/* Hour ticks */}
              {ticks.map((tick, i) => {
                const p = pct(tick.getTime())
                if (p < 0 || p > 100) return null
                return (
                  <div
                    key={i}
                    className="absolute bottom-0 flex flex-col items-center"
                    style={{ left: `${p}%`, transform: 'translateX(-50%)' }}
                  >
                    <span className="text-[10px] tabular-nums font-medium text-[var(--text-muted)] mb-1 whitespace-nowrap">
                      {fmt2(tick.getHours())}:00
                    </span>
                    <div className="h-2 w-px" style={{ background: 'var(--border)' }} />
                  </div>
                )
              })}
              {/* NOW label on ruler */}
              {nowPct >= 0 && nowPct <= 100 && (
                <div
                  className="absolute bottom-0 flex flex-col items-center z-10"
                  style={{ left: `${nowPct}%`, transform: 'translateX(-50%)' }}
                >
                  <span className="text-[10px] font-bold text-[var(--red)] mb-1 whitespace-nowrap tabular-nums">
                    {fmtTime(now)}
                  </span>
                  <div className="h-2.5 w-0.5 bg-[var(--red)]" />
                </div>
              )}
            </div>

            {/* Status column spacer */}
            <div className="shrink-0" style={{ width: '5rem' }} />
          </div>

          {/* ── Student rows ── */}
          {items.map((item, idx) => {
            const startP = pct(item.departedAt.getTime())
            const endMs  = item.expectedReturn?.getTime() ?? nowMs + 2 * 3600_000
            const endP   = pct(endMs)
            const barW   = Math.max(1, endP - startP)

            const isOverdue    = !!item.expectedReturn && item.expectedReturn.getTime() < nowMs
            const minsLeftMs   = item.expectedReturn ? item.expectedReturn.getTime() - nowMs : null
            const isAlmostDue  = minsLeftMs !== null && minsLeftMs > 0 && minsLeftMs < 30 * 60_000

            const barColor =
              isOverdue    ? 'var(--red)'
              : isAlmostDue ? 'var(--orange)'
              : item.variant === 'noApproval'  ? 'var(--orange)'
              : item.variant === 'withUrgent'  ? '#818CF8'
              : 'var(--blue)'

            return (
              <div
                key={item.student.id}
                className="timeline-row-enter flex items-center gap-3 py-1.5"
                style={{ animationDelay: `${idx * 55}ms` }}
              >
                {/* ── Name column (RTL) ── */}
                <div
                  dir="rtl"
                  className="shrink-0 text-right leading-tight"
                  style={{ width: '9rem' }}
                >
                  <p className="text-sm font-semibold text-[var(--text)] truncate">
                    {item.student.fullName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {item.student.classId}
                  </p>
                </div>

                {/* ── Bar area ── */}
                <div className="flex-1 relative h-9">
                  {/* Track */}
                  <div
                    className="absolute inset-0 rounded-lg"
                    style={{ background: 'var(--bg-2)' }}
                  />

                  {/* NOW vertical line */}
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div
                      className="timeline-now-line absolute top-0 bottom-0 w-0.5 z-10 rounded-full"
                      style={{ left: `${nowPct}%`, background: 'var(--red)' }}
                    />
                  )}

                  {/* Departure bar */}
                  <div
                    className={`timeline-bar-enter absolute top-1.5 bottom-1.5 rounded-md ${isOverdue ? 'timeline-overdue' : ''}`}
                    style={{
                      left: `${startP}%`,
                      width: `${barW}%`,
                      background: barColor,
                      animationDelay: `${idx * 55}ms`,
                    }}
                  />

                  {/* Time labels inside bar (only if bar is wide enough) */}
                  {barW > 18 && (
                    <div
                      className="absolute top-1.5 bottom-1.5 z-20 flex items-center justify-between px-2 pointer-events-none overflow-hidden"
                      style={{ left: `${startP}%`, width: `${barW}%` }}
                    >
                      <span className="text-[10px] font-bold text-white/90 whitespace-nowrap tabular-nums">
                        {fmtTime(item.departedAt)}
                      </span>
                      {item.expectedReturn && barW > 28 && (
                        <span className="text-[10px] font-bold text-white/90 whitespace-nowrap tabular-nums">
                          {fmtTime(item.expectedReturn)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Status badge ── */}
                <div className="shrink-0 text-center" style={{ width: '5rem' }}>
                  {isOverdue ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      איחור
                    </span>
                  ) : minsLeftMs !== null ? (
                    <span
                      className={`text-xs font-semibold tabular-nums whitespace-nowrap ${
                        isAlmostDue ? 'text-orange-500' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {fmtMinsLeft(minsLeftMs)}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">ללא ח.ז.</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── WeeklyComparisonChart ───────────────────────────────────────────────────

function WeeklyComparisonChart({ data }: { data: WeeklyPoint[] }) {
  // Summary: total off-campus this week vs last week
  const thisTotal = data.reduce((s, d) => s + d.thisWeek, 0)
  const lastTotal = data.reduce((s, d) => s + d.lastWeek, 0)
  const diff      = thisTotal - lastTotal
  const pctChange = lastTotal > 0 ? Math.round(Math.abs(diff) / lastTotal * 100) : 0

  const TrendIcon =
    diff > 0 ? TrendingUp
    : diff < 0 ? TrendingDown
    : Minus

  const trendColor =
    diff > 0 ? 'text-red-500'   // more departures = bad
    : diff < 0 ? 'text-green-500'
    : 'text-[var(--text-muted)]'

  const trendLabel =
    diff > 0 ? `+${pctChange}% לעומת שבוע שעבר`
    : diff < 0 ? `${pctChange}% פחות מהשבוע שעבר`
    : 'זהה לשבוע שעבר'

  return (
    <div
      className="overflow-hidden rounded-2xl animate-slide-up delay-200"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: 'rgba(59,130,246,0.1)' }}
          >
            <TrendingUp className="h-4 w-4 text-[var(--blue)]" />
          </div>
          <div>
            <p className="text-base font-bold text-[var(--text)]">השוואה שבועית — יציאות</p>
            <p className="text-xs text-[var(--text-muted)]">יציאות לפי יום: השבוע מול שבוע שעבר</p>
          </div>
        </div>

        {/* Trend badge */}
        <div className={`flex items-center gap-1.5 text-sm font-semibold ${trendColor}`}>
          <TrendIcon className="h-4 w-4" />
          <span>{trendLabel}</span>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="px-4 pt-4 pb-2" dir="ltr">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'Heebo, sans-serif' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'Heebo, sans-serif' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                direction: 'rtl',
                fontFamily: 'Heebo, sans-serif',
                fontSize: '13px',
              }}
              formatter={(value: number, name: string) => [
                `${value} יציאות`,
                name === 'thisWeek' ? 'השבוע' : 'שבוע שעבר',
              ]}
              labelFormatter={(label) => {
                const point = data.find(d => d.day === label)
                return point ? `${point.dayFull}` : label
              }}
            />
            <Legend
              formatter={(value) => (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'Heebo, sans-serif' }}>
                  {value === 'thisWeek' ? 'השבוע' : 'שבוע שעבר'}
                </span>
              )}
            />
            <Line
              type="monotone"
              dataKey="thisWeek"
              name="thisWeek"
              stroke="var(--blue)"
              strokeWidth={2.5}
              dot={{ r: 4, fill: 'var(--blue)', strokeWidth: 0 }}
              activeDot={{ r: 6, fill: 'var(--blue)' }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="lastWeek"
              name="lastWeek"
              stroke="var(--text-muted)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: 'var(--text-muted)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  count: number
  colorClass: string
  bgClass: string
  borderClass: string
}

function SectionHeader({ icon, title, count, colorClass, bgClass, borderClass }: SectionHeaderProps) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${bgClass} ${borderClass}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgClass}`}>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${colorClass}`}>{title}</p>
      </div>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${colorClass} ${bgClass} border ${borderClass}`}>
        {count}
      </span>
    </div>
  )
}

interface StudentCardProps {
  student: Student
  variant: 'overdue' | 'noApproval' | 'withApproval' | 'withUrgent'
}

function StudentCard({ student: s, variant }: StudentCardProps) {
  const isOverdue    = variant === 'overdue'
  const isNoApproval = variant === 'noApproval'
  const isUrgent     = variant === 'withUrgent'

  const borderColor =
    isOverdue     ? 'border-red-200 dark:border-red-800/40'
    : isNoApproval ? 'border-orange-200 dark:border-orange-800/40'
    : isUrgent     ? 'border-indigo-200 dark:border-indigo-800/40'
    :                'border-blue-200 dark:border-blue-800/40'

  const bgColor =
    isOverdue     ? 'bg-red-50/60 dark:bg-red-950/10'
    : isNoApproval ? 'bg-orange-50/60 dark:bg-orange-950/10'
    : isUrgent     ? 'bg-indigo-50/60 dark:bg-indigo-950/10'
    :                'bg-blue-50/60 dark:bg-blue-950/10'

  const lastSeenColor =
    isOverdue     ? 'text-red-600 dark:text-red-400'
    : isNoApproval ? 'text-orange-600 dark:text-orange-400'
    : isUrgent     ? 'text-indigo-600 dark:text-indigo-400'
    :                'text-blue-600 dark:text-blue-400'

  return (
    <Card className={`border ${borderColor} ${bgColor}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-2)]">
                <User className="h-4 w-4 text-[var(--text-muted)]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text)] leading-tight">{s.fullName}</p>
                <p className="text-xs text-[var(--text-muted)]">{s.classId}</p>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] pr-10">ת.ז. {s.idNumber}</p>

            <div className={`flex items-center gap-1.5 pr-10 text-xs font-medium ${lastSeenColor}`}>
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {isOverdue
                ? <span>באיחור — נעדר {timeAgo(s.lastSeen)}</span>
                : <span>יצא {timeAgo(s.lastSeen)}</span>
              }
            </div>

            {isNoApproval && (
              <div className="pr-10">
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  <AlertTriangle className="h-3 w-3" />
                  ללא אישור
                </span>
              </div>
            )}

            {isUrgent && (
              <div className="pr-10">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  <ShieldCheck className="h-3 w-3" />
                  אישור חריג
                </span>
              </div>
            )}
          </div>

          {s.phone && (
            <a
              href={`tel:${s.phone}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-[var(--blue)] shadow-sm hover:bg-blue-50 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">{s.phone}</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export function ExceptionsPage() {
  const [categorised, setCategorised] = useState<CategorisedStudents>({
    noApproval: [],
    withApproval: [],
    withUrgent: [],
  })
  const [departures,   setDepartures]   = useState<DepartureInfo[]>([])
  const [weeklyData,   setWeeklyData]   = useState<WeeklyPoint[]>([])
  const [now,          setNow]          = useState<Date>(new Date())
  const [isLoading,    setIsLoading]    = useState(true)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick every 30 s to keep "now" line and countdowns fresh
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(new Date()), 30_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  // ── Build weekly chart data from 14 days of presence ──────────────────────
  function buildWeeklyPoints(raw: DailyPresenceData[]): WeeklyPoint[] {
    // Build a map date → offCampus
    const byDate = new Map(raw.map(d => [d.date, d.offCampus]))

    const today   = new Date()
    const points: WeeklyPoint[] = []

    for (let i = 6; i >= 0; i--) {
      // This-week day
      const thisDay  = new Date(today)
      thisDay.setDate(today.getDate() - i)
      const thisDayStr = thisDay.toISOString().slice(0, 10)

      // Last-week same weekday
      const lastDay  = new Date(thisDay)
      lastDay.setDate(thisDay.getDate() - 7)
      const lastDayStr = lastDay.toISOString().slice(0, 10)

      const dowIdx = thisDay.getDay() // 0=Sun
      points.push({
        day:      HE_DAYS_SHORT[dowIdx],
        dayFull:  HE_DAYS[dowIdx],
        date:     thisDayStr,
        thisWeek: byDate.get(thisDayStr) ?? 0,
        lastWeek: byDate.get(lastDayStr) ?? 0,
      })
    }

    return points
  }

  // ── Load all data ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [allStudents, activeDeps, presenceRaw] = await Promise.all([
        api.getStudents(),
        api.listDepartures({ status: 'ACTIVE' }) as Promise<CalendarDeparture[]>,
        api.getDailyPresence(14),
      ])

      // Build map: student_id → active departure
      const depMap = new Map<string, CalendarDeparture>()
      for (const dep of activeDeps) depMap.set(dep.student_id, dep)

      // Off-campus students (union of currentStatus + active departures)
      const activeIds = new Set(activeDeps.map(d => d.student_id))
      const outsideStudents = allStudents.filter(
        (s: Student) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE' || activeIds.has(s.id)
      )

      const noApproval   = outsideStudents.filter((s: Student) => !depMap.has(s.id))
      const withUrgent   = outsideStudents.filter((s: Student) => depMap.get(s.id)?.is_urgent === true)
      const withApproval = outsideStudents.filter((s: Student) => depMap.has(s.id) && !depMap.get(s.id)?.is_urgent)
      setCategorised({ noApproval, withApproval, withUrgent })

      // ── Build timeline from departure data (no events query needed) ──
      const infos: DepartureInfo[] = outsideStudents.map((s: Student) => {
        const dep = depMap.get(s.id)
        return {
          student:        s,
          departedAt:     dep ? new Date(dep.start_at) : new Date(s.lastSeen ?? Date.now()),
          expectedReturn: dep ? new Date(dep.end_at) : null,
          variant:        dep ? (dep.is_urgent ? 'withUrgent' : 'withApproval') : 'noApproval',
        }
      })

      infos.sort((a, b) => {
        const nowMs = Date.now()
        const aMs = a.expectedReturn?.getTime() ?? Infinity
        const bMs = b.expectedReturn?.getTime() ?? Infinity
        const aOverdue = a.expectedReturn && aMs < nowMs
        const bOverdue = b.expectedReturn && bMs < nowMs
        if (aOverdue && !bOverdue) return -1
        if (!aOverdue && bOverdue) return 1
        return aMs - bMs
      })
      setDepartures(infos)

      setWeeklyData(buildWeeklyPoints(presenceRaw))
    } catch (err) {
      console.error('Failed to load exceptions data', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    loadData()

    const studentsChannel = supabase
      .channel('exceptions-students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => loadData())
      .subscribe()

    return () => { supabase.removeChannel(studentsChannel) }
  }, [loadData])

  useDeparturesRealtime({ onAnyChange: loadData })

  const totalOutside =
    categorised.noApproval.length +
    categorised.withApproval.length +
    categorised.withUrgent.length

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-4 lg:p-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">חריגות עכשיו</h2>
          <p className="text-sm text-[var(--text-muted)]">מעקב בזמן אמת אחר תלמידים מחוץ לישיבה</p>
        </div>
        {/* Skeleton shimmer */}
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-16 rounded-2xl animate-pulse"
              style={{ background: 'var(--bg-2)', animationDelay: `${i * 100}ms` }}
            />
          ))}
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (totalOutside === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 lg:p-6" dir="rtl">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">חריגות עכשיו</h2>
          <p className="text-sm text-[var(--text-muted)]">מעקב בזמן אמת אחר תלמידים מחוץ לישיבה</p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-green-200 bg-green-50/60 py-16 dark:border-green-800/40 dark:bg-green-950/10">
          <CheckCircle className="h-14 w-14 text-green-500" />
          <p className="text-lg font-semibold text-green-700 dark:text-green-400">
            אין חריגות — כל התלמידים בישיבה
          </p>
        </div>
        {/* Weekly chart still visible when all are on campus */}
        {weeklyData.length > 0 && <WeeklyComparisonChart data={weeklyData} />}
      </div>
    )
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6" dir="rtl">

      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">חריגות עכשיו</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {totalOutside} תלמידים מחוץ לישיבה כרגע
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/20">
          <AlertOctagon className="h-5 w-5 text-[var(--red)]" />
        </div>
      </div>

      {/* ── Departure Timeline (flight board) ── */}
      <DepartureTimeline items={departures} now={now} />

      {/* ── Weekly comparison chart ── */}
      {weeklyData.length > 0 && <WeeklyComparisonChart data={weeklyData} />}

      {/* ── Category 1: OFF_CAMPUS without approval ── */}
      {categorised.noApproval.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<AlertTriangle className="h-4.5 w-4.5" />}
            title="בחוץ ללא אישור"
            count={categorised.noApproval.length}
            colorClass="text-orange-600 dark:text-orange-400"
            bgClass="bg-orange-50 dark:bg-orange-950/20"
            borderClass="border-orange-200 dark:border-orange-800/40"
          />
          {categorised.noApproval.map((s) => (
            <StudentCard key={s.id} student={s} variant="noApproval" />
          ))}
        </section>
      )}

      {/* ── Category 2: OFF_CAMPUS with urgent approval ── */}
      {categorised.withUrgent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<ShieldCheck className="h-4.5 w-4.5" />}
            title="בחוץ חריג"
            count={categorised.withUrgent.length}
            colorClass="text-indigo-600 dark:text-indigo-400"
            bgClass="bg-indigo-50 dark:bg-indigo-950/20"
            borderClass="border-indigo-200 dark:border-indigo-800/40"
          />
          {categorised.withUrgent.map((s) => (
            <StudentCard key={s.id} student={s} variant="withUrgent" />
          ))}
        </section>
      )}

      {/* ── Category 3: OFF_CAMPUS with regular approval ── */}
      {categorised.withApproval.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<CheckCircle className="h-4.5 w-4.5" />}
            title="בחוץ באישור"
            count={categorised.withApproval.length}
            colorClass="text-blue-600 dark:text-blue-400"
            bgClass="bg-blue-50 dark:bg-blue-950/20"
            borderClass="border-blue-200 dark:border-blue-800/40"
          />
          {categorised.withApproval.map((s) => (
            <StudentCard key={s.id} student={s} variant="withApproval" />
          ))}
        </section>
      )}

    </div>
  )
}
