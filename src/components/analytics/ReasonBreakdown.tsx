import { useEffect, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/lib/api'
import type { ReasonData } from '@/types'

const COLORS = ['#3B82F6', '#8B5CF6', '#F97316', '#22C55E', '#EF4444', '#EC4899', '#14B8A6']

export function ReasonBreakdown() {
  const [data, setData] = useState<ReasonData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    api
      .getReasonBreakdown()
      .then(setData)
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

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--text-muted)]">
        אין נתונים
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="reason"
          cx="50%"
          cy="50%"
          outerRadius={70}
          label={({ reason, percent }) =>
            `${reason} ${(percent * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
    </ResponsiveContainer>
  )
}
