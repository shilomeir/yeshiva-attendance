import React, { Fragment, useEffect, useRef, useState } from 'react'
import {
  Users, UserCheck, UserX, CalendarOff, Phone,
  AlertOctagon, CheckCircle2, XCircle, MapPin, Bell, Send, Loader2, Clock,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PresenceChart } from '@/components/analytics/PresenceChart'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { CAMPUS_LAT, CAMPUS_LNG, AREA_RADIUS_METERS } from '@/lib/location/gps'
import type { DashboardStats, Student, AbsenceRequest, ClassStat } from '@/types'

// ── location helpers ────────────────────────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getLocationCategory(student: Student): 'inYeshiva' | 'inArea' | 'far' {
  if (student.currentStatus === 'ON_CAMPUS') return 'inYeshiva'
  if (student.lastLocation) {
    const dist = haversineDistance(CAMPUS_LAT, CAMPUS_LNG, student.lastLocation.lat, student.lastLocation.lng)
    if (dist <= AREA_RADIUS_METERS) return 'inArea'
  }
  return 'far'
}

// ── stat cards config ───────────────────────────────────────────────────────
const STAT_CARDS = [
  {
    key: 'total' as const,
    label: 'סה"כ תלמידים',
    icon: Users,
    iconColor: 'var(--blue)',
    iconBg: 'rgba(59,130,246,0.12)',
    strip: 'var(--blue)',
  },
  {
    key: 'onCampus' as const,
    label: 'בישיבה',
    icon: UserCheck,
    iconColor: 'var(--green)',
    iconBg: 'rgba(34,197,94,0.12)',
    strip: 'var(--green)',
  },
  {
    key: 'offCampus' as const,
    label: 'מחוץ לישיבה',
    icon: UserX,
    iconColor: 'var(--orange)',
    iconBg: 'rgba(249,115,22,0.12)',
    strip: 'var(--orange)',
  },
]

type UrgentWithStudent = AbsenceRequest & { studentName: string; studentClass: string }
type DepartureEntry = AbsenceRequest & { studentName: string; studentClass: string }

function getTodayStr() { return new Date().toISOString().slice(0, 10) }
function parseTimeToday(t: string): Date {
  const [h, m] = t.split(':').map(Number)
  const d = new Date(); d.setHours(h, m, 0, 0); return d
}
function minsRemaining(endTime: string) {
  return Math.round((parseTimeToday(endTime).getTime() - Date.now()) / 60000)
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [longAbsentStudents, setLongAbsentStudents] = useState<Student[]>([])
  const [urgentRequests, setUrgentRequests] = useState<UrgentWithStudent[]>([])
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [locationBreakdown, setLocationBreakdown] = useState({ inYeshiva: 0, inArea: 0, far: 0 })
  const [todayDepartures, setTodayDepartures] = useState<DepartureEntry[]>([])
  const [, setTick] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [displayPct, setDisplayPct] = useState(0)
  const [heroDone, setHeroDone] = useState(false)
  const animFrameRef = useRef<number | null>(null)

  // Broadcast notification state
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number; failed: number; lastError?: string } | null>(null)
  const broadcastResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = async (isBackground = false) => {
    if (!isBackground) setIsLoading(true)
    // Auto-return students whose expected return time has passed
    api.autoReturnStudents().catch(() => {})
    try {
      // Fetch everything in parallel — including approved requests that were previously serial
      const [data, absent, urgent, clsStats, allStudents, approvedRequests] = await Promise.all([
        api.getDashboardStats(),
        api.getLongAbsentStudents(7),
        api.getUrgentRequests(),
        api.getClassStats(),
        api.getStudents(),
        api.getAbsenceRequests({ status: 'APPROVED' }),
      ])
      setStats(data)
      setLongAbsentStudents(absent)
      setClassStats(clsStats)

      // Compute location-based breakdown for pie chart
      const breakdown = { inYeshiva: 0, inArea: 0, far: 0 }
      for (const s of allStudents as Student[]) {
        breakdown[getLocationCategory(s)]++
      }
      setLocationBreakdown(breakdown)

      // Filter today's approved departures
      const today = getTodayStr()
      const todayReqs = approvedRequests.filter((r) => r.date === today && minsRemaining(r.endTime) > -60)

      // Batch-fetch all students needed for enrichment in a single query (no N+1)
      const neededIds = [...new Set([
        ...urgent.map((r: AbsenceRequest) => r.studentId),
        ...todayReqs.map((r) => r.studentId),
      ])]
      const studentMap = await api.getStudentsByIds(neededIds)

      const enriched = urgent.map((req: AbsenceRequest) => ({
        ...req,
        studentName: studentMap[req.studentId]?.fullName ?? 'לא ידוע',
        studentClass: studentMap[req.studentId]?.classId ?? '',
      }))
      setUrgentRequests(enriched)

      const departures = todayReqs.map((req) => ({
        ...req,
        studentName: studentMap[req.studentId]?.fullName ?? 'לא ידוע',
        studentClass: studentMap[req.studentId]?.classId ?? '',
      }))
      departures.sort((a, b) => a.startTime.localeCompare(b.startTime))
      setTodayDepartures(departures)
    } catch {
      console.error('Failed to load dashboard stats')
    } finally {
      if (!isBackground) setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const studentsChannel = supabase
      .channel('dashboard-students-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => loadData(true))
      .subscribe()

    const requestsChannel = supabase
      .channel('dashboard-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests' }, () => loadData(true))
      .subscribe()

    // Poll auto-return every 60 seconds
    const autoReturnInterval = setInterval(() => {
      api.autoReturnStudents().catch(() => {})
    }, 60000)

    // Tick every minute to keep departure countdowns live
    const tickInterval = setInterval(() => setTick((t) => t + 1), 60000)

    return () => {
      supabase.removeChannel(studentsChannel)
      supabase.removeChannel(requestsChannel)
      clearInterval(autoReturnInterval)
      clearInterval(tickInterval)
    }
  }, [])

  const handleUrgent = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    await api.updateAbsenceRequestStatus(id, status)
    setUrgentRequests((prev) => prev.filter((r) => r.id !== id))
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!broadcastTitle.trim() && !broadcastBody.trim()) return
    setBroadcastSending(true)
    setBroadcastResult(null)
    try {
      const result = await api.sendPushToAll(broadcastTitle.trim(), broadcastBody.trim())
      setBroadcastResult(result)
      setBroadcastTitle('')
      setBroadcastBody('')
      if (broadcastResultTimer.current) clearTimeout(broadcastResultTimer.current)
      broadcastResultTimer.current = setTimeout(() => setBroadcastResult(null), 6000)
    } finally {
      setBroadcastSending(false)
    }
  }

  // Hero %
  const onCampusPct = stats && stats.total > 0 ? Math.round((stats.onCampus / stats.total) * 100) : 0

  // Animate counter from 0 → onCampusPct over 2.5s (easeOutCubic) when data arrives
  useEffect(() => {
    if (isLoading) {
      setDisplayPct(0)
      setHeroDone(false)
      return
    }
    const target = onCampusPct
    const duration = 2500
    const startTime = performance.now()
    setHeroDone(false)

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      setDisplayPct(Math.round(easeOutCubic(progress) * target))
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        setHeroDone(true)
      }
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isLoading, onCampusPct])

  // Color shifts live as displayPct climbs: 0-30 red → 31-60 orange → 61+ green
  const liveColor = (pct: number): string => {
    if (pct <= 30) return '#EF4444'
    if (pct <= 60) return '#F97316'
    return '#22C55E'
  }
  const heroAccent = liveColor(displayPct)

  // Pie chart — 3 location categories
  const pieData = stats
    ? [
        { name: 'בישיבה', value: locationBreakdown.inYeshiva, color: '#22C55E' },
        { name: 'באזור', value: locationBreakdown.inArea, color: '#3B82F6' },
        { name: 'רחוק', value: locationBreakdown.far, color: '#EF4444' },
      ].filter((d) => d.value > 0)
    : []

  // Bar chart by grade — built from live classStats, not hardcoded GRADE_LEVELS
  const gradeChartData = (() => {
    const gradeNames = [...new Set(classStats.map((cs) => cs.grade))].sort()
    return gradeNames.map((grade) => {
      const classes = classStats.filter((cs) => cs.grade === grade)
      return {
        name: grade,
        בישיבה: classes.reduce((s, cs) => s + cs.onCampus, 0),
        מחוץ: classes.reduce((s, cs) => s + cs.offCampus, 0),
      }
    }).filter((d) => d.בישיבה + d.מחוץ > 0)
  })()

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">לוח בקרה</h2>
        <p className="text-sm text-[var(--text-muted)]">סקירה כללית של נוכחות התלמידים</p>
      </div>

      {/* Hero — % on campus */}
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="p-5">
          <div className="flex items-end gap-4">
            {/* Number — pulses once when animation finishes */}
            <span
              key={heroDone ? 'done' : 'counting'}
              className={`text-6xl font-extrabold leading-none tabular-nums${heroDone ? ' hero-pulse' : ''}`}
              style={{
                color: heroAccent,
                '--pulse-color': heroAccent,
                transition: 'color 0.4s ease',
              } as React.CSSProperties}
            >
              {isLoading ? '—' : `${displayPct}%`}
            </span>
            <div className="mb-1 flex flex-col gap-0.5">
              <span className="text-base font-semibold text-[var(--text)]">מתוך התלמידים בישיבה כרגע</span>
              {stats && (
                <span className="text-sm text-[var(--text-muted)]">
                  {stats.onCampus} מתוך {stats.total} תלמידים
                </span>
              )}
            </div>
          </div>
          {/* Bar — same live color, pulses once on finish */}
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
            <div
              key={heroDone ? 'bar-done' : 'bar-counting'}
              className={heroDone ? 'hero-pulse h-full rounded-full' : 'h-full rounded-full'}
              style={{
                width: `${displayPct}%`,
                background: heroAccent,
                '--pulse-color': heroAccent,
                transition: 'background 0.4s ease',
              } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      {/* Today's departures */}
      {todayDepartures.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--blue)]" />
              <CardTitle className="text-base">יציאות היום ({todayDepartures.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {todayDepartures.map((dep) => {
                const mins = minsRemaining(dep.endTime)
                const isActive = minsRemaining(dep.startTime) <= 0 && mins > 0
                const isPending = minsRemaining(dep.startTime) > 0
                return (
                  <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm text-[var(--text)]">{dep.studentName}</span>
                      <span className="mx-1.5 text-[var(--text-muted)] text-xs">·</span>
                      <span className="text-xs text-[var(--text-muted)]">{dep.studentClass}</span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)] shrink-0">{dep.startTime}–{dep.endTime}</span>
                    <span className={`text-xs font-medium shrink-0 ${isActive ? 'text-orange-500' : isPending ? 'text-blue-500' : 'text-[var(--text-muted)]'}`}>
                      {isActive ? `נותרו ${mins} דק'` : isPending ? `בעוד ${minsRemaining(dep.startTime)} דק'` : 'הסתיים'}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pie chart — 3 location categories */}
      {!isLoading && pieData.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--blue)]" />
              <CardTitle className="text-base">התפלגות מיקום תלמידים</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center sm:flex-row sm:items-center sm:justify-center gap-4">
              <PieChart width={220} height={200}>
                <Pie
                  data={pieData}
                  cx={110}
                  cy={95}
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    direction: 'rtl',
                  }}
                />
              </PieChart>
              {/* Legend */}
              <div className="flex flex-col gap-2.5">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-sm text-[var(--text)]">{entry.name}</span>
                    <span className="text-sm font-bold text-[var(--text)]">{entry.value}</span>
                    {stats && (
                      <span className="text-xs text-[var(--text-muted)]">
                        ({Math.round((entry.value / stats.total) * 100)}%)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        {STAT_CARDS.map(({ key, label, icon: Icon, iconColor, iconBg, strip }) => (
          <div
            key={key}
            className="overflow-hidden rounded-2xl"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-card)',
              borderRight: `3px solid ${strip}`,
            }}
          >
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--text-muted)] truncate">{label}</p>
                  <p className="mt-1.5 text-3xl font-extrabold text-[var(--text)] leading-none">
                    {isLoading ? '—' : (stats?.[key] ?? 0)}
                  </p>
                </div>
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: iconBg }}
                >
                  <Icon className="h-5 w-5" style={{ color: iconColor }} />
                </div>
              </div>
              {stats && key !== 'total' && (
                <p className="mt-2.5 text-xs font-medium" style={{ color: iconColor }}>
                  {((stats[key] / stats.total) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Urgent requests widget */}
      {!isLoading && urgentRequests.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50 dark:border-orange-900/50 dark:bg-orange-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900/30">
                <AlertOctagon className="h-5 w-5 text-[var(--orange)]" />
              </div>
              <div>
                <CardTitle className="text-base text-[var(--orange)]">בקשות חריגות</CardTitle>
                <p className="text-xs text-[var(--text-muted)]">
                  {urgentRequests.length} בקשות ממתינות לאישור
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-orange-100 dark:divide-orange-900/30">
              {urgentRequests.map((req) => (
                <li key={req.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--text)]">{req.studentName}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {req.studentClass} · {req.date}
                      {req.endDate && req.endDate !== req.date ? ` — ${req.endDate}` : ''}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{req.reason}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => handleUrgent(req.id, 'APPROVED')}
                      className="flex items-center gap-1 rounded-lg bg-green-100 px-2.5 py-1.5 text-xs font-medium text-[var(--green)] hover:bg-green-200 transition-colors dark:bg-green-900/30"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      אשר
                    </button>
                    <button
                      onClick={() => handleUrgent(req.id, 'REJECTED')}
                      className="flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-xs font-medium text-[var(--red)] hover:bg-red-200 transition-colors dark:bg-red-900/30"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      דחה
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Long absent alert */}
      {!isLoading && longAbsentStudents.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/30">
                <CalendarOff className="h-5 w-5 text-[var(--red)]" />
              </div>
              <div>
                <CardTitle className="text-base text-[var(--red)]">לא נוכחים 7 ימים ומעלה</CardTitle>
                <p className="text-xs text-[var(--text-muted)]">
                  {longAbsentStudents.length} תלמידים לא נרשמו כנוכחים מזה שבוע
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-red-100 dark:divide-red-900/30">
              {longAbsentStudents.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-medium text-[var(--text)]">{s.fullName}</p>
                    <p className="text-xs text-[var(--text-muted)]">ת.ז. {s.idNumber}</p>
                  </div>
                  <a
                    href={`tel:${s.phone}`}
                    className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-[var(--blue)] shadow-sm hover:bg-blue-50 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {s.phone}
                  </a>
                </li>
              ))}
              {longAbsentStudents.length > 8 && (
                <li className="pt-2 text-center text-xs text-[var(--text-muted)]">
                  ועוד {longAbsentStudents.length - 8} נוספים — ראה בדף תלמידים
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Presence chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">נוכחות — 4 ימים אחורה ו-4 ימים קדימה</CardTitle>
        </CardHeader>
        <CardContent>
          <PresenceChart />
        </CardContent>
      </Card>

      {/* Class stats */}
      {!isLoading && classStats.length > 0 && (
        <>
          {/* Bar chart by grade */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">נוכחות לפי שכבה</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={gradeChartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      direction: 'rtl',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', direction: 'rtl' }} />
                  <Bar dataKey="בישיבה" fill="#22C55E" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="מחוץ" fill="#F97316" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Class stats table — grouped by grade */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">נתוני כיתות</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-2)]">
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--text-muted)]">שכבה / כיתה</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--text-muted)]">סה"כ</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--green)]">בישיבה</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--orange)]">מחוץ</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--text-muted)]">היעדרות</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--text-muted)]">מכסה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(classStats.map((cs) => cs.grade))].sort().map((gradeName) => {
                      const gradeClasses = classStats
                        .filter((cs) => cs.grade === gradeName)
                        .sort((a, b) => a.classId.localeCompare(b.classId, 'he'))
                      if (gradeClasses.length === 0) return null

                      const gTotal     = gradeClasses.reduce((s, cs) => s + cs.total, 0)
                      const gOnCampus  = gradeClasses.reduce((s, cs) => s + cs.onCampus, 0)
                      const gOffCampus = gradeClasses.reduce((s, cs) => s + cs.offCampus, 0)
                      const gAbsRate   = gTotal > 0 ? (gOffCampus / gTotal) * 100 : 0
                      const gHighAbs   = gAbsRate > 20
                      const multiClass = gradeClasses.length > 1

                      const gradeQuota = gradeClasses.reduce((sum) => {
                        return sum + (gTotal >= 50 ? 6 : 3)
                      }, 0)
                      const gradeQuotaExceeded = gOffCampus >= gradeQuota

                      return (
                        <Fragment key={gradeName}>
                          <tr className="border-b border-[var(--border)] bg-[var(--bg-2)]">
                            <td className="px-4 py-2.5 font-bold text-[var(--text)]">
                              <span>{gradeName}</span>
                              {gHighAbs && (
                                <span className="mr-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-[var(--red)] dark:bg-red-900/30">
                                  ⚠ {gAbsRate.toFixed(0)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--text)]">{gTotal}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--green)]">{gOnCampus}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--orange)]">{gOffCampus}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`font-semibold ${gHighAbs ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                {gAbsRate.toFixed(0)}%
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`font-semibold ${gradeQuotaExceeded ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                {gOffCampus}/{gradeQuota}
                              </span>
                            </td>
                          </tr>

                          {multiClass && gradeClasses.map((cs) => {
                            const absRate = cs.total > 0 ? (cs.offCampus / cs.total) * 100 : 0
                            const highAbs = absRate > 20
                            const classLabel = cs.classId.includes(' כיתה ')
                              ? `כיתה ${cs.classId.split(' כיתה ')[1]}`
                              : cs.classId
                            const classQuota = gTotal >= 50 ? 6 : 3
                            const classQuotaExceeded = cs.offCampus >= classQuota
                            return (
                              <tr
                                key={cs.classId}
                                className={`border-b border-[var(--border)] last:border-b-0 ${highAbs ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                              >
                                <td className="py-2 pl-4 pr-10 text-[var(--text-muted)]">{classLabel}</td>
                                <td className="px-3 py-2 text-center text-[var(--text-muted)]">{cs.total}</td>
                                <td className="px-3 py-2 text-center text-[var(--green)]">{cs.onCampus}</td>
                                <td className="px-3 py-2 text-center text-[var(--orange)]">{cs.offCampus}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`font-medium ${highAbs ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                    {absRate.toFixed(0)}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`font-medium ${classQuotaExceeded ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                    {cs.offCampus}/{classQuota}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Broadcast push notification */}
      <Card className="border-[var(--blue)]/30 bg-blue-50/40 dark:bg-blue-950/10">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/30">
              <Bell className="h-5 w-5 text-[var(--blue)]" />
            </div>
            <div>
              <CardTitle className="text-base text-[var(--blue)]">שליחת התראות לכולם</CardTitle>
              <p className="text-xs text-[var(--text-muted)]">שלח התראה לכל המכשירים הרשומים</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleBroadcast} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="כותרת ההתראה (לא חובה)"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
              dir="rtl"
            />
            <textarea
              placeholder="תוכן ההתראה..."
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
              dir="rtl"
            />
            <button
              type="submit"
              disabled={broadcastSending || (!broadcastTitle.trim() && !broadcastBody.trim())}
              className="flex items-center justify-center gap-2 rounded-lg bg-[var(--blue)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {broadcastSending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  שולח...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  שלח לכולם
                </>
              )}
            </button>
            {broadcastResult && (
              <div className="flex flex-col gap-1">
                <p className={`text-center text-sm font-medium ${broadcastResult.failed > 0 && broadcastResult.sent === 0 ? 'text-[var(--red)]' : broadcastResult.failed > 0 ? 'text-[var(--orange)]' : 'text-[var(--green)]'}`}>
                  {broadcastResult.sent > 0
                    ? `✓ נשלח ל-${broadcastResult.sent} מכשירים${broadcastResult.failed > 0 ? ` · נכשל: ${broadcastResult.failed}` : ''}`
                    : broadcastResult.failed > 0
                    ? `שגיאה — השליחה נכשלה (${broadcastResult.failed} מכשירים)`
                    : 'אין מכשירים רשומים כרגע'}
                </p>
                {broadcastResult.lastError && (
                  <p className="text-center text-xs text-[var(--text-muted)] break-all">{broadcastResult.lastError}</p>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
