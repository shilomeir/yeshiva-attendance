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
import { StatusBadge } from '@/components/shared/StatusBadge'
import { api } from '@/lib/api'
import { db } from '@/lib/db/schema'
import { cn } from '@/lib/utils/cn'
import type { AbsenceRequest } from '@/types'

interface DayData {
  date: Date
  offCampusCount: number
  absenceRequests: AbsenceRequest[]
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
      const total = await db.students.count()
      setTotalStudents(total)

      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)
      const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

      const approvedRequests = await api.getAbsenceRequests({ status: 'APPROVED' })
      const allEvents = await db.events
        .where('type')
        .equals('CHECK_OUT')
        .toArray()

      const newDayData = new Map<string, DayData>()

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayStart = new Date(dateStr + 'T00:00:00')
        const dayEnd = new Date(dateStr + 'T23:59:59')

        const offCampusCount = allEvents.filter((e) => {
          const eventDate = new Date(e.timestamp)
          return eventDate >= dayStart && eventDate <= dayEnd
        }).length

        const dayRequests = approvedRequests.filter((r) => r.date === dateStr)

        newDayData.set(dateStr, {
          date: day,
          offCampusCount,
          absenceRequests: dayRequests,
          totalStudents: total,
        })
      }

      setDayData(newDayData)
    } catch (err) {
      console.error('Failed to load calendar data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [currentMonth])

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  // Get day-of-week for first day (0=Sun, 6=Sat) — in RTL/Hebrew calendar order
  const firstDayOfWeek = getDay(startOfMonth(currentMonth))

  const getDayColor = (data: DayData | undefined): string => {
    if (!data || data.offCampusCount === 0) return ''
    const pct = (data.offCampusCount / data.totalStudents) * 100
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
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[var(--blue)] opacity-60" />בקשות מאושרות</span>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-[var(--border)]">
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            טוען נתונים...
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {/* Empty cells for first week offset */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="border-b border-e border-[var(--border)] p-2 min-h-[70px]" />
            ))}

            {days.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd')
              const data = dayData.get(dateStr)
              const dayColor = getDayColor(data)
              const hasApproved = (data?.absenceRequests.length ?? 0) > 0

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
                  {data && data.offCampusCount > 0 && (
                    <div className="mt-1">
                      <span className="text-xs font-bold">{data.offCampusCount}</span>
                      <span className="text-xs"> יציאות</span>
                    </div>
                  )}
                  {hasApproved && (
                    <div className="absolute bottom-1 end-1 h-2 w-2 rounded-full bg-[var(--blue)]" />
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
              <h3 className="font-semibold text-[var(--text)]">
                {format(selectedDay.date, 'EEEE, d בMMMM', { locale: he })}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-[var(--text-muted)] mb-3">
              {selectedDay.offCampusCount} יציאות מתועדות ({((selectedDay.offCampusCount / selectedDay.totalStudents) * 100).toFixed(1)}%)
            </p>

            {selectedDay.absenceRequests.length > 0 && (
              <div>
                <p className="text-sm font-medium text-[var(--text)] mb-2">בקשות מאושרות:</p>
                <div className="flex flex-col gap-2">
                  {selectedDay.absenceRequests.map((req) => (
                    <div key={req.id} className="rounded-lg bg-[var(--bg-2)] p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--text)]">{req.reason}</span>
                        <StatusBadge status="OFF_CAMPUS" />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {req.startTime} — {req.endTime}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
