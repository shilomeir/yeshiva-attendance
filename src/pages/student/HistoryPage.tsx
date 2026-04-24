import { useEffect, useState, useCallback } from 'react'
import { ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle, AlertOctagon, Activity, CalendarIcon, Play } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import { supabase } from '@/lib/supabase'
import type { Event, CalendarDeparture } from '@/types'

type TimelineItem =
  | { kind: 'event'; data: Event; sortKey: string }
  | { kind: 'departure'; data: CalendarDeparture; sortKey: string }

function formatDateHebrew(isoStr: string): string {
  const d = new Date(isoStr)
  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ]
  return `${d.getDate()} ב${monthNames[d.getMonth()]} ${d.getFullYear()}`
}

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getDateStr(isoStr: string): string {
  return new Date(isoStr).toISOString().slice(0, 10)
}

export function HistoryPage() {
  const { currentUser } = useAuthStore()
  const [events, setEvents] = useState<Event[]>([])
  const [departures, setDepartures] = useState<CalendarDeparture[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!currentUser) return
    setIsLoading(true)
    try {
      const [eventsData, departuresData] = await Promise.all([
        api.getEvents(currentUser.id),
        api.listDepartures({ studentId: currentUser.id }),
      ])
      setEvents(eventsData)
      setDepartures(departuresData)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setIsLoading(false)
    }
  }, [currentUser?.id])

  useEffect(() => { loadData() }, [currentUser?.id])

  // Events realtime (CHECK_IN events from returnDeparture, OVERRIDE events)
  useEffect(() => {
    if (!currentUser) return
    const ch = supabase
      .channel(`history-events-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `studentId=eq.${currentUser.id}` }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [currentUser?.id])

  // Departures realtime
  useDeparturesRealtime({ onAnyChange: loadData })

  // Only show events that aren't simply the CHECK_OUT/CHECK_IN linked to a departure
  // (those are represented by the departure card itself). Show OVERRIDE and SMS events.
  const auditEvents = events.filter(
    (e) => e.type === 'OVERRIDE' || e.type === 'SMS_IN' || e.type === 'SMS_OUT'
  )

  const eventItems: TimelineItem[] = auditEvents.map((e) => ({
    kind: 'event' as const,
    data: e,
    sortKey: e.timestamp,
  }))

  const depItems: TimelineItem[] = departures.map((d) => ({
    kind: 'departure' as const,
    data: d,
    sortKey: d.start_at,
  }))

  const timeline = [...eventItems, ...depItems].sort((a, b) =>
    b.sortKey.localeCompare(a.sortKey)
  )

  return (
    <div className="flex flex-col gap-4 p-4 pt-6" dir="rtl">
      <h2 className="text-xl font-bold text-[var(--text)]">ציר הזמן</h2>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="text-[var(--text-muted)]">טוען...</div>
        </div>
      ) : timeline.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <CalendarIcon className="h-10 w-10 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">אין פעילות עדיין</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {timeline.map((item) => {
            if (item.kind === 'event') {
              return <EventItem key={`event-${item.data.id}`} event={item.data} />
            }
            return <DepartureItem key={`dep-${item.data.id}`} departure={item.data} />
          })}
        </div>
      )}
    </div>
  )
}

// ─── Event item (OVERRIDE / SMS only) ────────────────────────────────────────

function EventItem({ event }: { event: Event }) {
  let iconBg: string
  let iconColor: string
  let label: string
  let IconComponent: React.ElementType

  if (event.type === 'CHECK_OUT') {
    iconBg = 'bg-orange-100 dark:bg-orange-950/30'
    iconColor = 'text-[var(--orange)]'
    label = 'יציאה'
    IconComponent = ArrowUpRight
  } else if (event.type === 'CHECK_IN') {
    iconBg = 'bg-green-100 dark:bg-green-950/30'
    iconColor = 'text-[var(--green)]'
    label = 'כניסה'
    IconComponent = ArrowDownLeft
  } else {
    iconBg = 'bg-gray-100 dark:bg-gray-800/40'
    iconColor = 'text-[var(--text-muted)]'
    label = event.type === 'OVERRIDE' ? 'עדכון ידני' : event.type === 'SMS_IN' ? 'SMS — כניסה' : 'SMS — יציאה'
    IconComponent = Activity
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
            <IconComponent className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--text)]">
              {label}
              {event.reason && ` — ${event.reason}`}
            </p>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {formatDateTimeHebrew(event.timestamp)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Departure item ───────────────────────────────────────────────────────────

function DepartureItem({ departure: dep }: { departure: CalendarDeparture }) {
  const depDateStr = getDateStr(dep.start_at)
  const endDateStr = getDateStr(dep.end_at)
  const dateLabel = endDateStr !== depDateStr
    ? `${formatDateHebrew(dep.start_at)} — ${formatDateHebrew(dep.end_at)}`
    : formatDateHebrew(dep.start_at)

  let iconBg: string
  let iconColor: string
  let statusLabel: string
  let IconComponent: React.ElementType

  switch (dep.status) {
    case 'PENDING':
      iconBg = 'bg-yellow-100 dark:bg-yellow-950/30'
      iconColor = 'text-[var(--orange)]'
      statusLabel = 'בקשה ממתינה'
      IconComponent = Clock
      break
    case 'APPROVED':
      iconBg = 'bg-blue-100 dark:bg-blue-950/30'
      iconColor = 'text-blue-600 dark:text-blue-400'
      statusLabel = 'בקשה אושרה'
      IconComponent = CheckCircle
      break
    case 'ACTIVE':
      iconBg = 'bg-orange-100 dark:bg-orange-950/30'
      iconColor = 'text-[var(--orange)]'
      statusLabel = 'מחוץ לישיבה'
      IconComponent = Play
      break
    case 'COMPLETED':
      iconBg = 'bg-green-100 dark:bg-green-950/30'
      iconColor = 'text-[var(--green)]'
      statusLabel = 'יציאה הסתיימה'
      IconComponent = CheckCircle
      break
    case 'REJECTED':
      iconBg = 'bg-red-100 dark:bg-red-950/30'
      iconColor = 'text-[var(--red)]'
      statusLabel = 'בקשה נדחתה'
      IconComponent = XCircle
      break
    default:
      iconBg = 'bg-gray-100 dark:bg-gray-800/40'
      iconColor = 'text-[var(--text-muted)]'
      statusLabel = 'בוטלה'
      IconComponent = XCircle
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
            <IconComponent className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-[var(--text)]">{statusLabel}</p>
              {dep.is_urgent && (
                <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                  <AlertOctagon className="h-2.5 w-2.5" />
                  חריג
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{dateLabel}</p>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3.5 w-3.5" />
              {getTimeStr(dep.start_at)} — {getTimeStr(dep.end_at)}
            </div>
            {dep.reason && <p className="mt-1 text-sm text-[var(--text-muted)]">{dep.reason}</p>}
            {dep.admin_note && (
              <p className="mt-1.5 text-xs text-[var(--text-muted)] italic">
                הערת מנהל: {dep.admin_note}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
