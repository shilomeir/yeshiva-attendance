import { useEffect, useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  getDay,
} from 'date-fns'
import { he } from 'date-fns/locale'
import { ChevronRight, ChevronLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils/cn'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import type { CalendarDeparture } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:   'ממתין',
  APPROVED:  'מאושר',
  ACTIVE:    'בחוץ',
  COMPLETED: 'חזר',
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  APPROVED:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ACTIVE:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

interface DayData {
  date: Date
  exitCount: number
  departures: CalendarDeparture[]
  totalStudents: number
}

export function AbsenceCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [dayData, setDayData] = useState<Map<string, DayData>>(new Map())
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null)
  const [totalStudents, setTotalStudents] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)
      const monthStartStr = format(monthStart, 'yyyy-MM-dd')
      const monthEndStr   = format(monthEnd, 'yyyy-MM-dd')

      // Fetch a generous window: departures starting from a month before so multi-day
      // departures that started before the month are captured.
      const fromDate = new Date(monthStart)
      fromDate.setMonth(fromDate.getMonth() - 1)

      const [allDeps, stats] = await Promise.all([
        api.listDepartures({ from: fromDate }),
        api.getDashboardStats(),
      ])

      const total = stats.total
      setTotalStudents(total)

      const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
      const newDayData = new Map<string, DayData>()

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayDeps = allDeps.filter((d) => {
          const depStart = d.start_at.slice(0, 10)
          const depEnd   = d.end_at.slice(0, 10)
          return depStart <= dateStr && depEnd >= dateStr
        })
        // Also ensure departure overlaps the selected month
        if (dateStr >= monthStartStr && dateStr <= monthEndStr) {
          newDayData.set(dateStr, {
            date: day,
            exitCount: dayDeps.length,
            departures: dayDeps,
            totalStudents: total,
          })
        }
      }

      setDayData(newDayData)
    } catch (err) {
      console.error('Failed to load calendar data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadData() }, [currentMonth])

  useDeparturesRealtime({ onAnyChange: loadData })

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  const firstDayOfWeek = getDay(startOfMonth(currentMonth))

  const getDayColor = (data: DayData | undefined): string => {
    if (!data || data.exitCount === 0) return ''
    const pct = (data.exitCount / data.totalStudents) * 100
    if (pct < 5) return 'bg-green-100 text-green-800 dark:bg-green-900/30'
    if (pct < 15) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30'
    return 'bg-red-100 text-red-800 dark:bg-red-900/30'
  }

  const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold text-[var(--text)]">
          {format(currentMonth, 'MMMM yyyy', { locale: he })}
        </h2>
        <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-green-200" />פחות מ-5%</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-yellow-200" />5-15%</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-200" />מעל 15%</span>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)]">
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
              {day}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            טוען נתונים...
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="border-b border-e border-[var(--border)] p-2 min-h-[70px]" />
            ))}

            {days.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const data = dayData.get(dateStr)
              const dayColor = getDayColor(data)

              return (
                <div
                  key={dateStr}
                  className={cn(
                    'relative cursor-pointer border-b border-e border-[var(--border)] p-2 min-h-[70px] transition-all hover:opacity-80',
                    dayColor,
                    !isSameMonth(day, currentMonth) && 'opacity-30'
                  )}
                  onClick={() => setSelectedDay(data ?? null)}
                >
                  <span className="text-sm font-medium">{format(day, 'd')}</span>
                  {data && data.exitCount > 0 && (
                    <div className="mt-1">
                      <span className="text-xs font-bold">{data.exitCount}</span>
                      <span className="text-xs"> יציאות</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-[var(--text)]">
                  {format(selectedDay.date, 'EEEE, d בMMMM', { locale: he })}
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">
                  {selectedDay.exitCount} יציאות
                  {selectedDay.totalStudents > 0 && ` (${((selectedDay.exitCount / selectedDay.totalStudents) * 100).toFixed(1)}%)`}
                </p>
              </div>
              <button onClick={() => setSelectedDay(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedDay.departures.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">אין יציאות ביום זה</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedDay.departures.map((dep) => (
                  <div key={dep.id} className="rounded-lg bg-[var(--bg-2)] p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-[var(--text)]">{dep.student_name}</p>
                          {dep.is_urgent && (
                            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                              חריג
                            </span>
                          )}
                        </div>
                        {(dep.grade || dep.class_id) && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {dep.grade}{dep.grade && dep.class_id ? ' · ' : ''}{dep.class_id}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">
                          {getTimeStr(dep.start_at)}–{getTimeStr(dep.end_at)}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[dep.status] ?? ''}`}>
                          {STATUS_LABEL[dep.status] ?? dep.status}
                        </span>
                      </div>
                    </div>
                    {dep.reason && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{dep.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
