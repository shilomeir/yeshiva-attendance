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

export function PresenceChart() {
  const [data, setData] = useState<DailyPresenceData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api
      .getDailyPresence(7)
      .then((d) =>
        setData(
          d.map((item) => ({
            ...item,
            date: formatShortDate(item.date),
          }))
        )
      )
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--text-muted)]">
        טוען גרף...
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
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
        />
        <Line
          type="monotone"
          dataKey="offCampus"
          name="מחוץ לישיבה"
          stroke="#F97316"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
