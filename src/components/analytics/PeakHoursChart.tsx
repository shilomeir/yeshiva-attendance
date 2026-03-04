import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/lib/api'
import type { HourlyData } from '@/types'

type HourlyChartData = HourlyData & { hourLabel: string }

export function PeakHoursChart() {
  const [data, setData] = useState<HourlyChartData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api
      .getHourlyDepartures()
      .then((d) =>
        setData(
          d.map((item) => ({
            ...item,
            hourLabel: `${item.hour}:00`,
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

  const chartData = data

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="hourLabel"
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          interval={2}
        />
        <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            direction: 'rtl',
          }}
          formatter={(value) => [`${value} יציאות`, 'כמות']}
        />
        <Bar dataKey="count" name="יציאות" fill="#3B82F6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
