import { useEffect, useState } from 'react'
import { Users, UserCheck, UserX, AlertTriangle, CalendarOff, Phone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PresenceChart } from '@/components/analytics/PresenceChart'
import { PeakHoursChart } from '@/components/analytics/PeakHoursChart'
import { api } from '@/lib/api'
import type { DashboardStats, Student } from '@/types'

const STAT_CARDS = [
  {
    key: 'total' as const,
    label: 'סה"כ תלמידים',
    icon: Users,
    color: 'text-[var(--blue)]',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
  },
  {
    key: 'onCampus' as const,
    label: 'בישיבה',
    icon: UserCheck,
    color: 'text-[var(--green)]',
    bg: 'bg-green-50 dark:bg-green-950/20',
  },
  {
    key: 'offCampus' as const,
    label: 'מחוץ לישיבה',
    icon: UserX,
    color: 'text-[var(--orange)]',
    bg: 'bg-orange-50 dark:bg-orange-950/20',
  },
  {
    key: 'overdue' as const,
    label: 'באיחור',
    icon: AlertTriangle,
    color: 'text-[var(--red)]',
    bg: 'bg-red-50 dark:bg-red-950/20',
  },
]

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [longAbsentStudents, setLongAbsentStudents] = useState<Student[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const [data, absent] = await Promise.all([
          api.getDashboardStats(),
          api.getLongAbsentStudents(7),
        ])
        setStats(data)
        setLongAbsentStudents(absent)
      } catch {
        console.error('Failed to load dashboard stats')
      } finally {
        setIsLoading(false)
      }
    }
    load()

    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [])

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

      {/* Long absent alert — only shown when relevant */}
      {!isLoading && longAbsentStudents.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900/30">
                <CalendarOff className="h-5 w-5 text-[var(--red)]" />
              </div>
              <div>
                <CardTitle className="text-base text-[var(--red)]">
                  לא נוכחים 7 ימים ומעלה
                </CardTitle>
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

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">נוכחות לאורך 7 ימים</CardTitle>
          </CardHeader>
          <CardContent>
            <PresenceChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">שעות עומס (יציאות לפי שעה)</CardTitle>
          </CardHeader>
          <CardContent>
            <PeakHoursChart />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
