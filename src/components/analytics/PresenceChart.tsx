import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/lib/api'
import { formatShortDate } from '@/lib/utils/formatTime'
import type { DailyPresenceData } from '@/types'

interface ChartItem extends DailyPresenceData {
  isFuture?: boolean
}

export function PresenceChart() {
  const [data, setData] = useState<ChartItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      // Past 4 days including today
      const past = await api.getDailyPresence(4)

      // Future 4 days from approved/active departures
      const approvedDeps = await api.listDepartures({ status: ['APPROVED', 'ACTIVE'] })
      const futureDays: ChartItem[] = []
      for (let i = 1; i <= 4; i++) {
        const d = new Date()
        d.setDate(d.getDate() + i)
        const dateStr = d.toISOString().split('T')[0]
        // Count departures covering this date
        const expectedOut = approvedDeps.filter((dep) =>
          dep.start_at.slice(0, 10) <= dateStr && dep.end_at.slice(0, 10) >= dateStr
        ).length
        futureDays.push({ date: dateStr, onCampus: 0, offCampus: expectedOut, isFuture: true })
      }

      const combined: ChartItem[] = [
        ...past.map((item) => ({ ...item, isFuture: false })),
        ...futureDays,
      ].map((item) => ({
        ...item,
        date: formatShortDate(item.date),
      }))

      setData(combined)
    }
    load().catch(console.error).finally(() => setIsLoading(false))
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--text-muted)]">
        טוען גרף...
      </div>
    )
  }

  // Split into past/today data and future data for separate line rendering
  const pastCount = data.findIndex((d) => d.isFuture)
  const splitIndex = pastCount === -1 ? data.length : pastCount

  // Build two series: actual (past + today) and projected (future offCampus only)
  const chartData = data.map((item, idx) => ({
    date: item.date,
    onCampus: idx < splitIndex ? item.onCampus : undefined,
    offCampus: idx < splitIndex ? item.offCampus : undefined,
    צפוי: idx >= splitIndex ? item.offCampus : undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
        <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            direction: 'rtl',
          }}
        />
        <Legend wrapperStyle={{ fontSize: '12px', direction: 'rtl' }} />
        <Line
          type="monotone"
          dataKey="onCampus"
          name="בישיבה"
          stroke="#22C55E"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="offCampus"
          name="מחוץ לישיבה"
          stroke="#F97316"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="צפוי"
          name="היעדרויות צפויות"
          stroke="#F97316"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
