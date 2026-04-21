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
import type { AbsenceRequest, Event, Student } from '@/types'

interface EnrichedRequest extends AbsenceRequest {
  studentName: string
  studentClass: string
  studentGrade: string
}

interface DayData {
  date: Date
  exitCount: number
  requests: EnrichedRequest[]
  totalStudents: number
}

function toIsraelDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
}

function toIsraelTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem',
  })
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
      const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
      const monthStartStr = format(monthStart, 'yyyy-MM-dd')
      const monthEndStr = format(monthEnd, 'yyyy-MM-dd')

      const [approvedRequests, allStudents, checkoutEvents] = await Promise.all([
        api.getAbsenceRequests({ status: 'APPROVED' }),
        api.getStudents(),
        api.getEventsByDateRange(monthStartStr, monthEndStr),
      ])

      const total = (allStudents as Student[]).length
      setTotalStudents(total)

      const studentMap = new Map<string, Student>()
      for (const s of allStudents as Student[]) studentMap.set(s.id, s)

      // Enrich approved absence requests
      const enriched: EnrichedRequest[] = approvedRequests.map((r) => {
        const s = studentMap.get(r.studentId)
        return {
          ...r,
          studentName: s?.fullName ?? 'לא ידוע',
          studentClass: s?.classId ?? '',
          studentGrade: s?.grade ?? '',
        }
      })

      // Build a set of (studentId|date) pairs already covered by a request
      // so we don't double-count when an event also exists for the same student+day
      const coveredKeys = new Set<string>()
      for (const r of enriched) {
        const endD = r.endDate ?? r.date
        // mark every day covered by this multi-day (or single-day) request
        const start = new Date(r.date)
        const end = new Date(endD)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          coveredKeys.add(`${r.studentId}|${format(d, 'yyyy-MM-dd')}`)
        }
      }

      // Convert checkout events that are NOT already covered by an absence request
      const eventRows: EnrichedRequest[] = (checkoutEvents as Event[])
        .filter((e) => {
          const eventDate = toIsraelDate(e.timestamp)
          return !coveredKeys.has(`${e.studentId}|${eventDate}`)
        })
        .map((e) => {
          const s = studentMap.get(e.studentId)
          const eventDate = toIsraelDate(e.timestamp)
          const startTime = toIsraelTime(e.timestamp)
          const endTime = e.expectedReturn ? toIsraelTime(e.expectedReturn) : '–'
          return {
            id: e.id,
            studentId: e.studentId,
            date: eventDate,
            endDate: e.expectedReturn ? toIsraelDate(e.expectedReturn) : null,
            reason: e.reason ?? 'יציאה',
            startTime,
            endTime,
            status: 'APPROVED' as const,
            adminNote: null,
            isUrgent: false,
            createdAt: e.timestamp,
            studentName: s?.fullName ?? 'לא ידוע',
            studentClass: s?.classId ?? '',
            studentGrade: s?.grade ?? '',
          }
        })

      const allDepartures = [...enriched, ...eventRows]

      const newDayData = new Map<string, DayData>()
      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayRequests = allDepartures.filter((r) => {
          if (r.date > dateStr) return false
          const end = r.endDate ?? r.date
          return end >= dateStr
        })
        newDayData.set(dateStr, {
          date: day,
          exitCount: dayRequests.length,
          requests: dayRequests,
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

            {selectedDay.requests.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">אין יציאות ביום זה</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedDay.requests.map((req) => (
                  <div key={req.id} className="rounded-lg bg-[var(--bg-2)] p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--text)]">{req.studentName}</p>
                        {(req.studentGrade || req.studentClass) && (
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {req.studentGrade}
                            {req.studentGrade && req.studentClass ? ' · ' : ''}
                            {req.studentClass}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-[var(--text-muted)] shrink-0">
                        {req.startTime}–{req.endTime}
                      </span>
                    </div>
                    {req.reason && req.reason !== 'יציאה' && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{req.reason}</p>
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
