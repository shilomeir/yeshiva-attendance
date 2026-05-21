import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  AlertOctagon, Phone, Clock, CheckCircle, AlertTriangle, ShieldCheck,
  TrendingUp, TrendingDown, Minus, Filter, X as XIcon,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { getErrorMessage } from '@/lib/errors'
import type { Student, CalendarDeparture, DailyPresenceData } from '@/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return 'לא ידוע'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `לפני ${diffMins} דקות`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `לפני ${diffHours} שעות`
  return `לפני ${Math.floor(diffHours / 24)} ימים`
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
  day: string
  dayFull: string
  thisWeek: number
  lastWeek: number
  date: string
}

// ─── CategoryCard ─────────────────────────────────────────────────────────────

function CategoryCard({ icon, label, tone, count, desc }: {
  icon: React.ReactNode; label: string; tone: string
  count: number; desc: string
}) {
  const map: Record<string, { c: string; s: string }> = {
    bad:  { c: 'var(--bad)',  s: 'var(--bad-soft)'  },
    plum: { c: 'var(--plum)', s: 'var(--plum-soft)' },
    info: { c: 'var(--info)', s: 'var(--info-soft)'  },
  }
  const m = map[tone] ?? map.info
  return (
    <div className="glass" style={{ padding: 'var(--card-pad)', borderTop: `3px solid ${m.c}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: m.s, color: m.c,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
      </div>
      <div className="font-mono-num" style={{ fontSize: 42, fontWeight: 600, color: m.c, lineHeight: 1, letterSpacing: '-0.03em' }}>
        {count}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.45 }}>{desc}</p>
    </div>
  )
}

// ─── DepartureTimeline ───────────────────────────────────────────────────────

function DepartureTimeline({ items, now }: { items: DepartureInfo[]; now: Date }) {
  if (items.length === 0) return null

  const nowMs = now.getTime()
  const departureTimes = items.map(i => i.departedAt.getTime())
  const returnTimes    = items.map(i => i.expectedReturn?.getTime() ?? nowMs + 2 * 3600_000)
  const windowStart    = new Date(Math.min(...departureTimes) - 30 * 60_000)
  const windowEnd      = new Date(Math.max(Math.max(...returnTimes) + 30 * 60_000, nowMs + 60 * 60_000))
  const windowDur      = windowEnd.getTime() - windowStart.getTime()

  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - windowStart.getTime()) / windowDur) * 100))
  const nowPct = pct(nowMs)

  const ticks: Date[] = []
  const t = new Date(windowStart)
  t.setMinutes(0, 0, 0)
  if (t <= windowStart) t.setHours(t.getHours() + 1)
  while (t <= windowEnd) { ticks.push(new Date(t)); t.setHours(t.getHours() + 1) }

  return (
    <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>תזמון</div>
          <h3 style={{ marginTop: 4, fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>לוח יציאות פעילות</h3>
        </div>
        <div className="font-mono-num" style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 600, padding: '4px 12px', background: 'var(--bad-soft)', borderRadius: 999 }}>
          ● {fmtTime(now)}
        </div>
      </div>

      <div style={{ padding: '14px 22px', overflowX: 'auto' }}>
        <div style={{ minWidth: 480 }}>
          {/* Ruler */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 8 }}>
            <div style={{ width: 150, flexShrink: 0 }} />
            <div style={{ flex: 1, height: 24, position: 'relative', borderBottom: '1px solid var(--hairline)' }}>
              {ticks.map((tick, i) => {
                const p = pct(tick.getTime())
                if (p < 0 || p > 100) return null
                return (
                  <div key={i} style={{ position: 'absolute', insetInlineStart: `${p}%`, transform: 'translateX(50%)', bottom: 0 }}>
                    <span className="font-mono-num" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{fmt2(tick.getHours())}:00</span>
                    <div style={{ width: 1, height: 4, background: 'var(--hairline-2)', margin: '2px auto 0' }} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Rows */}
          {items.map((item, idx) => {
            const startP = pct(item.departedAt.getTime())
            const endMs  = item.expectedReturn?.getTime() ?? nowMs + 2 * 3600_000
            const endP   = pct(endMs)
            const isOverdue   = !!item.expectedReturn && item.expectedReturn.getTime() < nowMs
            const minsLeftMs  = item.expectedReturn ? item.expectedReturn.getTime() - nowMs : null
            const isAlmostDue = minsLeftMs !== null && minsLeftMs > 0 && minsLeftMs < 30 * 60_000
            const barColor =
              isOverdue    ? 'var(--bad)'
              : isAlmostDue ? 'var(--warn)'
              : item.variant === 'noApproval'  ? 'var(--warn)'
              : item.variant === 'withUrgent'  ? 'var(--plum)'
              : 'var(--info)'
            const barW = Math.max(1, Math.abs(endP - startP))

            return (
              <div key={item.student.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0', borderBottom: idx < items.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ width: 150, flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.student.fullName}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.student.classId}</div>
                </div>
                <div style={{ flex: 1, position: 'relative', height: 32 }}>
                  <div style={{ position: 'absolute', insetInline: 0, top: 14, height: 4, background: 'rgba(20,18,25,0.05)', borderRadius: 999 }} />
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div style={{ position: 'absolute', insetInlineStart: `${nowPct}%`, top: 0, bottom: 0, width: 1, background: 'var(--bad)', zIndex: 2 }} />
                  )}
                  <div style={{
                    position: 'absolute',
                    insetInlineStart: `${Math.min(startP, endP)}%`,
                    width: `${barW}%`,
                    top: 8, height: 16, borderRadius: 999,
                    background: `linear-gradient(90deg, ${barColor}, color-mix(in oklch, ${barColor} 60%, white))`,
                    boxShadow: `0 2px 8px -2px ${barColor}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 6px', fontSize: 10, color: 'white', fontWeight: 600,
                    overflow: 'hidden',
                  }} dir="ltr">
                    <span className="font-mono-num">{fmtTime(item.departedAt)}</span>
                    {barW > 12 && item.expectedReturn && <span className="font-mono-num">{fmtTime(item.expectedReturn)}</span>}
                  </div>
                </div>
                <div style={{ width: 80, flexShrink: 0, textAlign: 'left' }}>
                  {isOverdue ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 11, fontWeight: 600 }}>
                      <Clock size={10} /> איחור
                    </span>
                  ) : minsLeftMs !== null ? (
                    <span className="font-mono-num" style={{ fontSize: 11, color: isAlmostDue ? 'var(--warn)' : 'var(--ink-muted)', fontWeight: 500 }}>
                      {fmtMinsLeft(minsLeftMs)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>ללא ח.ז.</span>
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
  const thisTotal = data.reduce((s, d) => s + d.thisWeek, 0)
  const lastTotal = data.reduce((s, d) => s + d.lastWeek, 0)
  const diff      = thisTotal - lastTotal
  const pctChange = lastTotal > 0 ? Math.round(Math.abs(diff) / lastTotal * 100) : 0
  const TrendIcon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus
  const trendColor = diff > 0 ? 'var(--bad)' : diff < 0 ? 'var(--good)' : 'var(--ink-muted)'
  const trendLabel = diff > 0 ? `+${pctChange}% לעומת שבוע שעבר` : diff < 0 ? `${pctChange}% פחות מהשבוע שעבר` : 'זהה לשבוע שעבר'

  return (
    <div className="glass" style={{ padding: 'var(--card-pad)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>השוואה</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>יציאות שבועיות</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: trendColor }}>
          <TrendIcon size={14} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{trendLabel}</span>
        </div>
      </div>
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: 'var(--ink-faint)', fontSize: 12, fontFamily: 'Heebo, sans-serif' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--ink-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--glass-3)', border: '1px solid var(--hairline)', borderRadius: 10, direction: 'rtl', fontFamily: 'Heebo, sans-serif', fontSize: 13 }}
              formatter={(value: number, name: string) => [`${value} יציאות`, name === 'thisWeek' ? 'השבוע' : 'שבוע שעבר']}
              labelFormatter={(label) => { const point = data.find(d => d.day === label); return point?.dayFull ?? label }}
            />
            <Legend formatter={(value) => <span style={{ color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'Heebo, sans-serif' }}>{value === 'thisWeek' ? 'השבוע' : 'שבוע שעבר'}</span>} />
            <Line type="monotone" dataKey="thisWeek" name="thisWeek" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls={false} />
            <Line type="monotone" dataKey="lastWeek" name="lastWeek" stroke="var(--ink-faint)" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, fill: 'var(--ink-faint)', strokeWidth: 0 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── CategorySection ──────────────────────────────────────────────────────────

function CategorySection({ title, tone, students }: { title: string; tone: string; students: Student[] }) {
  const colorMap: Record<string, string> = { bad: 'var(--bad)', plum: 'var(--plum)', info: 'var(--info)' }
  const color = colorMap[tone] ?? 'var(--info)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 6, height: 24, background: color, borderRadius: 3 }} />
        <h3 style={{ fontSize: 17, fontWeight: 500, color, margin: 0 }}>{title}</h3>
        <span style={{ padding: '2px 8px', borderRadius: 999, background: color + '18', color, fontSize: 12, fontWeight: 600 }}>{students.length}</span>
      </div>
      <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
        {students.map((s, i) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px',
            borderBottom: i === students.length - 1 ? 'none' : '1px solid var(--hairline)',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: `hsl(${[...s.fullName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 72%)`,
              color: `hsl(${[...s.fullName].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 28%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700,
            }}>
              {s.fullName.slice(0, 2)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{s.fullName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{s.classId} · ת.ז. {s.idNumber}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'left', flexShrink: 0 }}>
              <div>נראה לאחרונה</div>
              <div style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>{timeAgo(s.lastSeen)}</div>
            </div>
            {s.phone && (
              <a href={`tel:${s.phone}`} style={{
                padding: 8, borderRadius: 10, background: 'rgba(255,255,255,0.6)',
                border: '1px solid var(--hairline)', color: 'var(--accent-deep)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 500, textDecoration: 'none',
              }}>
                <Phone size={13} /> {s.phone}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export function ExceptionsPage() {
  const [categorised, setCategorised] = useState<CategorisedStudents>({ noApproval: [], withApproval: [], withUrgent: [] })
  const [departures,   setDepartures]   = useState<DepartureInfo[]>([])
  const [weeklyData,   setWeeklyData]   = useState<WeeklyPoint[]>([])
  const [now,          setNow]          = useState<Date>(new Date())
  const [isLoading,    setIsLoading]    = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterGrade,  setFilterGrade]  = useState('all')
  const [filterClass,  setFilterClass]  = useState('all')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(new Date()), 30_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  function buildWeeklyPoints(raw: DailyPresenceData[]): WeeklyPoint[] {
    const byDate = new Map(raw.map(d => [d.date, d.offCampus]))
    const today = new Date()
    const points: WeeklyPoint[] = []
    for (let i = 6; i >= 0; i--) {
      const thisDay = new Date(today); thisDay.setDate(today.getDate() - i)
      const lastDay = new Date(thisDay); lastDay.setDate(thisDay.getDate() - 7)
      const thisDayStr = thisDay.toISOString().slice(0, 10)
      const lastDayStr = lastDay.toISOString().slice(0, 10)
      const dowIdx = thisDay.getDay()
      points.push({ day: HE_DAYS_SHORT[dowIdx], dayFull: HE_DAYS[dowIdx], date: thisDayStr, thisWeek: byDate.get(thisDayStr) ?? 0, lastWeek: byDate.get(lastDayStr) ?? 0 })
    }
    return points
  }

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const [allStudents, activeDeps, presenceRaw] = await Promise.all([
        api.getStudents(),
        api.listDepartures({ status: 'ACTIVE' }) as Promise<CalendarDeparture[]>,
        api.getDailyPresence(14),
      ])
      const depMap = new Map<string, CalendarDeparture>()
      for (const dep of activeDeps) depMap.set(dep.student_id, dep)
      const activeIds = new Set(activeDeps.map(d => d.student_id))
      const outsideStudents = allStudents.filter(
        (s: Student) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE' || activeIds.has(s.id)
      )
      const noApproval   = outsideStudents.filter((s: Student) => !depMap.has(s.id))
      const withUrgent   = outsideStudents.filter((s: Student) => depMap.get(s.id)?.is_urgent === true)
      const withApproval = outsideStudents.filter((s: Student) => depMap.has(s.id) && !depMap.get(s.id)?.is_urgent)
      setCategorised({ noApproval, withApproval, withUrgent })
      const infos: DepartureInfo[] = outsideStudents.map((s: Student) => {
        const dep = depMap.get(s.id)
        return { student: s, departedAt: dep ? new Date(dep.start_at) : new Date(s.lastSeen ?? Date.now()), expectedReturn: dep ? new Date(dep.end_at) : null, variant: dep ? (dep.is_urgent ? 'withUrgent' : 'withApproval') : 'noApproval' }
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
      setErrorMessage(getErrorMessage(err, 'טעינת נתוני החריגות נכשלה'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Coalesce bursts of realtime events into a single refetch.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) return
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null
      loadData()
    }, 1500)
  }, [loadData])

  useEffect(() => {
    loadData()
    const studentsChannel = supabase.channel('exceptions-students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, scheduleReload)
      .subscribe()
    return () => {
      supabase.removeChannel(studentsChannel)
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [loadData, scheduleReload])

  useDeparturesRealtime({ onAnyChange: scheduleReload })

  // Derived filter options
  const allOutside = useMemo(() => [
    ...categorised.noApproval,
    ...categorised.withApproval,
    ...categorised.withUrgent,
  ], [categorised])

  const availableGrades = useMemo(() => [...new Set(allOutside.map(s => s.grade).filter(Boolean))], [allOutside])

  const classOptions = useMemo(() => {
    const source = filterGrade === 'all' ? allOutside : allOutside.filter(s => s.grade === filterGrade)
    return [...new Set(source.map(s => s.classId).filter(Boolean))]
  }, [allOutside, filterGrade])

  const filteredCategorised = useMemo(() => {
    const pass = (s: Student) => {
      if (filterGrade !== 'all' && s.grade !== filterGrade) return false
      if (filterClass !== 'all' && s.classId !== filterClass) return false
      return true
    }
    return {
      noApproval:   categorised.noApproval.filter(pass),
      withApproval: categorised.withApproval.filter(pass),
      withUrgent:   categorised.withUrgent.filter(pass),
    }
  }, [categorised, filterGrade, filterClass])

  const filteredDepartures = useMemo(() => {
    if (filterGrade === 'all' && filterClass === 'all') return departures
    const passIds = new Set([
      ...filteredCategorised.noApproval.map(s => s.id),
      ...filteredCategorised.withApproval.map(s => s.id),
      ...filteredCategorised.withUrgent.map(s => s.id),
    ])
    return departures.filter(d => passIds.has(d.student.id))
  }, [departures, filteredCategorised, filterGrade, filterClass])

  const totalOutside = categorised.noApproval.length + categorised.withApproval.length + categorised.withUrgent.length
  const filteredTotal = filteredCategorised.noApproval.length + filteredCategorised.withApproval.length + filteredCategorised.withUrgent.length

  const selectStyle: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 8,
    background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
    fontSize: 12.5, fontFamily: 'inherit', color: 'var(--ink)',
    cursor: 'pointer', outline: 'none',
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }} dir="rtl">
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--bad)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--bad)', display: 'inline-block' }} />
            עכשיו · בזמן אמת
          </div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>חריגות עכשיו</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="glass" style={{ height: 72, borderRadius: 20, animation: 'admin-pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }} dir="rtl">
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--bad)', marginBottom: 6 }}>עכשיו · בזמן אמת</div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>חריגות עכשיו</h1>
        </div>
        <div className="glass" style={{ padding: 16, borderInlineStart: '3px solid var(--bad)', background: 'var(--bad-soft)' }}>
          <p style={{ fontSize: 13, color: 'var(--bad)' }}>{errorMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }} dir="rtl">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--bad)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--bad)', display: 'inline-block', animation: 'admin-shimmer-pulse 1.4s ease-in-out infinite' }} />
            עכשיו · בזמן אמת
          </div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>
            <span className="font-mono-num">{totalOutside}</span>
            {' '}
            <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>מחוץ לישיבה</span>
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5 }}>
            מעקב בזמן אמת אחר תלמידים שנמצאים מחוץ לישיבה, יחד עם סטטוס אישורים.
          </p>
        </div>
      </div>

      {/* ── Filter row ────────────────────────────────────────────────── */}
      <div className="glass" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Filter size={15} style={{ color: 'var(--ink-muted)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-muted)' }}>סינון תצוגה:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>שכבה</span>
          <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setFilterClass('all') }} style={selectStyle}>
            <option value="all">כל השכבות</option>
            {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>כיתה</span>
          <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={selectStyle} disabled={classOptions.length <= 1}>
            <option value="all">כל הכיתות</option>
            {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(filterGrade !== 'all' || filterClass !== 'all') && (
          <button
            onClick={() => { setFilterGrade('all'); setFilterClass('all') }}
            style={{ marginInlineStart: 'auto', padding: '5px 10px', borderRadius: 8, background: 'transparent', border: '1px solid var(--hairline)', color: 'var(--ink-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <XIcon size={11} /> נקה סינון
          </button>
        )}
        <span style={{ marginInlineStart: filterGrade === 'all' && filterClass === 'all' ? 'auto' : '0', fontSize: 12, color: 'var(--ink-faint)' }}>
          {filteredTotal} תלמידים מתאימים
        </span>
      </div>

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {totalOutside === 0 && (
        <>
          <div className="glass" style={{ padding: 60, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <CheckCircle size={56} style={{ color: 'var(--good)', opacity: 0.8 }} />
            <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--good)' }}>אין חריגות — כל התלמידים בישיבה</p>
          </div>
          {weeklyData.length > 0 && <WeeklyComparisonChart data={weeklyData} />}
        </>
      )}

      {/* ── Category cards ────────────────────────────────────────────── */}
      {totalOutside > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--gap-sm)' }}>
            <CategoryCard icon={<AlertTriangle size={20} />} label="ללא אישור" tone="bad" count={filteredCategorised.noApproval.length} desc="לא נוכחים בישיבה ואין להם אישור פעיל" />
            <CategoryCard icon={<ShieldCheck size={20} />} label="באישור חריג" tone="plum" count={filteredCategorised.withUrgent.length} desc='אושר ע"י הר"מ או ראש הישיבה' />
            <CategoryCard icon={<CheckCircle size={20} />} label="באישור רגיל" tone="info" count={filteredCategorised.withApproval.length} desc="יציאה מתוכננת ומאושרת מראש" />
          </div>

          {/* Timeline */}
          <DepartureTimeline items={filteredDepartures} now={now} />

          {/* Weekly chart */}
          {weeklyData.length > 0 && <WeeklyComparisonChart data={weeklyData} />}

          {/* Category sections */}
          {filteredCategorised.noApproval.length > 0 && (
            <CategorySection title="בחוץ ללא אישור" tone="bad" students={filteredCategorised.noApproval} />
          )}
          {filteredCategorised.withUrgent.length > 0 && (
            <CategorySection title="בחוץ — אישור חריג" tone="plum" students={filteredCategorised.withUrgent} />
          )}
          {filteredCategorised.withApproval.length > 0 && (
            <CategorySection title="בחוץ באישור" tone="info" students={filteredCategorised.withApproval} />
          )}
        </>
      )}
    </div>
  )
}
