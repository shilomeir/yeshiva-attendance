import { useEffect, useState } from 'react'
import { Users, UserCheck, UserX, AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PresenceChart } from '@/components/analytics/PresenceChart'
import { ReasonBreakdown } from '@/components/analytics/ReasonBreakdown'
import { PeakHoursChart } from '@/components/analytics/PeakHoursChart'
import { api } from '@/lib/api'
import type { DashboardStats } from '@/types'

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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const data = await api.getDashboardStats()
        setStats(data)
      } catch {
        console.error('Failed to load dashboard stats')
      } finally {
        setIsLoading(false)
      }
    }
    load()

    // Refresh every 60 seconds
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
            <CardTitle className="text-base">סיבות יציאה</CardTitle>
          </CardHeader>
          <CardContent>
            <ReasonBreakdown />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">שעות עומס (יציאות לפי שעה)</CardTitle>
        </CardHeader>
        <CardContent>
          <PeakHoursChart />
        </CardContent>
      </Card>
    </div>
  )
}
