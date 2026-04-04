import { Fragment, useEffect, useState } from 'react'
import {
  Users, UserCheck, UserX, AlertTriangle, CalendarOff, Phone,
  AlertOctagon, CheckCircle2, XCircle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PresenceChart } from '@/components/analytics/PresenceChart'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { GRADE_LEVELS } from '@/lib/constants/grades'
import type { DashboardStats, Student, AbsenceRequest, ClassStat } from '@/types'

const STAT_CARDS = [
  { key: 'total' as const, label: 'סה"כ תלמידים', icon: Users, color: 'text-[var(--blue)]', bg: 'bg-blue-50 dark:bg-blue-950/20' },
  { key: 'onCampus' as const, label: 'בישיבה', icon: UserCheck, color: 'text-[var(--green)]', bg: 'bg-green-50 dark:bg-green-950/20' },
  { key: 'offCampus' as const, label: 'מחוץ לישיבה', icon: UserX, color: 'text-[var(--orange)]', bg: 'bg-orange-50 dark:bg-orange-950/20' },
  { key: 'overdue' as const, label: 'באיחור', icon: AlertTriangle, color: 'text-[var(--red)]', bg: 'bg-red-50 dark:bg-red-950/20' },
]

type UrgentWithStudent = AbsenceRequest & { studentName: string; studentClass: string }

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [longAbsentStudents, setLongAbsentStudents] = useState<Student[]>([])
  const [urgentRequests, setUrgentRequests] = useState<UrgentWithStudent[]>([])
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [data, absent, urgent, clsStats] = await Promise.all([
        api.getDashboardStats(),
        api.getLongAbsentStudents(7),
        api.getUrgentRequests(),
        api.getClassStats(),
      ])
      setStats(data)
      setLongAbsentStudents(absent)
      setClassStats(clsStats)

      // Enrich urgent requests with student info
      const enriched = await Promise.all(
        urgent.map(async (req) => {
          const student = await api.getStudent(req.studentId)
          return {
            ...req,
            studentName: student?.fullName ?? 'לא ידוע',
            studentClass: student?.classId ?? '',
          }
        })
      )
      setUrgentRequests(enriched)
    } catch {
      console.error('Failed to load dashboard stats')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    // Subscribe to realtime changes to auto-refresh dashboard
    const studentsChannel = supabase
      .channel('dashboard-students-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadData()
      })
      .subscribe()

    const requestsChannel = supabase
      .channel('dashboard-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests' }, () => {
        loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(studentsChannel)
      supabase.removeChannel(requestsChannel)
    }
  }, [])

  const handleUrgent = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    await api.updateAbsenceRequestStatus(id, status)
    setUrgentRequests((prev) => prev.filter((r) => r.id !== id))
  }

  // Aggregate class stats by grade for the bar chart
  const gradeChartData = GRADE_LEVELS.map((level) => {
    const classes = classStats.filter((cs) => cs.grade === level.name)
    return {
      name: level.name,
      בישיבה: classes.reduce((s, cs) => s + cs.onCampus, 0),
      מחוץ: classes.reduce((s, cs) => s + cs.offCampus, 0),
      באיחור: classes.reduce((s, cs) => s + cs.overdue, 0),
    }
  }).filter((d) => d.בישיבה + d.מחוץ + d.באיחור > 0)

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">לוח בקרה</h2>
        <p className="text-sm text-[var(--text-muted)]">סקירה כללית של נוכחות התלמידים</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }) => (
          <Card key={key}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)]">{label}</p>
                  <p className="mt-1 text-3xl font-bold text-[var(--text)]">
                    {isLoading ? '...' : (stats?.[key] ?? 0)}
                  </p>
                </div>
                <div className={`rounded-lg p-2 ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
              </div>
              {stats && key !== 'total' && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {((stats[key] / stats.total) * 100).toFixed(1)}% מסה"כ
                </p>
              )}
            </CardContent>
          </Card>
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
          <CardTitle className="text-base">נוכחות לאורך 7 ימים</CardTitle>
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
                  <Bar dataKey="באיחור" fill="#EF4444" radius={[3, 3, 0, 0]} />
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
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--red)]">באיחור</th>
                      <th className="px-3 py-2.5 text-center font-medium text-[var(--text-muted)]">היעדרות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GRADE_LEVELS.map((level) => {
                      const gradeClasses = classStats
                        .filter((cs) => cs.grade === level.name)
                        .sort((a, b) => a.classId.localeCompare(b.classId, 'he'))
                      if (gradeClasses.length === 0) return null

                      const gTotal     = gradeClasses.reduce((s, cs) => s + cs.total, 0)
                      const gOnCampus  = gradeClasses.reduce((s, cs) => s + cs.onCampus, 0)
                      const gOffCampus = gradeClasses.reduce((s, cs) => s + cs.offCampus, 0)
                      const gOverdue   = gradeClasses.reduce((s, cs) => s + cs.overdue, 0)
                      const gAbsRate   = gTotal > 0 ? ((gOffCampus + gOverdue) / gTotal) * 100 : 0
                      const gHighAbs   = gAbsRate > 20
                      const multiClass = gradeClasses.length > 1

                      return (
                        <Fragment key={level.name}>
                          {/* Grade summary row */}
                          <tr className="border-b border-[var(--border)] bg-[var(--bg-2)]">
                            <td className="px-4 py-2.5 font-bold text-[var(--text)]">
                              <span>{level.name}</span>
                              {gHighAbs && (
                                <span className="mr-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-[var(--red)] dark:bg-red-900/30">
                                  ⚠ {gAbsRate.toFixed(0)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--text)]">{gTotal}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--green)]">{gOnCampus}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--orange)]">{gOffCampus}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-[var(--red)]">{gOverdue}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`font-semibold ${gHighAbs ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                {gAbsRate.toFixed(0)}%
                              </span>
                            </td>
                          </tr>

                          {/* Per-class rows — only for multi-class grades */}
                          {multiClass && gradeClasses.map((cs) => {
                            const absRate = cs.total > 0
                              ? ((cs.offCampus + cs.overdue) / cs.total) * 100
                              : 0
                            const highAbs = absRate > 20
                            const classLabel = cs.classId.includes(' כיתה ')
                              ? `כיתה ${cs.classId.split(' כיתה ')[1]}`
                              : cs.classId
                            return (
                              <tr
                                key={cs.classId}
                                className={`border-b border-[var(--border)] last:border-b-0 ${highAbs ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                              >
                                <td className="py-2 pl-4 pr-10 text-[var(--text-muted)]">
                                  {classLabel}
                                </td>
                                <td className="px-3 py-2 text-center text-[var(--text-muted)]">{cs.total}</td>
                                <td className="px-3 py-2 text-center text-[var(--green)]">{cs.onCampus}</td>
                                <td className="px-3 py-2 text-center text-[var(--orange)]">{cs.offCampus}</td>
                                <td className="px-3 py-2 text-center text-[var(--red)]">{cs.overdue}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`font-medium ${highAbs ? 'text-[var(--red)]' : 'text-[var(--text-muted)]'}`}>
                                    {absRate.toFixed(0)}%
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
    </div>
  )
}
