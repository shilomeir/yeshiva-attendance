import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle, AlertOctagon, Activity, CalendarIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import type { Event, AbsenceRequest } from '@/types'

type TimelineItem =
  | { kind: 'event'; data: Event; sortKey: string }
  | { kind: 'request'; data: AbsenceRequest; sortKey: string }

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ]
  return `${parseInt(day)} ב${monthNames[parseInt(month) - 1]} ${year}`
}

export function HistoryPage() {
  const { currentUser } = useAuthStore()
  const [events, setEvents] = useState<Event[]>([])
  const [requests, setRequests] = useState<AbsenceRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadData = async () => {
    if (!currentUser) return
    setIsLoading(true)
    try {
      const [eventsData, requestsData] = await Promise.all([
        api.getEvents(currentUser.id),
        api.getAbsenceRequests({ studentId: currentUser.id }),
      ])
      setEvents(eventsData)
      setRequests(requestsData)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [currentUser?.id])

  // Realtime subscriptions
  useEffect(() => {
    if (!currentUser) return

    const eventsChannel = supabase
      .channel(`history-events-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `studentId=eq.${currentUser.id}` }, () => loadData())
      .subscribe()

    const requestsChannel = supabase
      .channel(`history-requests-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests', filter: `studentId=eq.${currentUser.id}` }, () => loadData())
      .subscribe()

    return () => {
      supabase.removeChannel(eventsChannel)
      supabase.removeChannel(requestsChannel)
    }
  }, [currentUser?.id])

  const eventItems: TimelineItem[] = events.map(e => ({ kind: 'event' as const, data: e, sortKey: e.timestamp }))
  const requestItems: TimelineItem[] = requests.map(r => ({ kind: 'request' as const, data: r, sortKey: r.createdAt }))
  const timeline = [...eventItems, ...requestItems].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

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
            return <RequestItem key={`request-${item.data.id}`} request={item.data} />
          })}
        </div>
      )}
    </div>
  )
}

// ─── Event item ───────────────────────────────────────────────────────────────

function EventItem({ event }: { event: Event }) {
  const isOut = event.type === 'CHECK_OUT'
  const isIn = event.type === 'CHECK_IN'

  let iconBg: string
  let iconColor: string
  let label: string
  let IconComponent: React.ElementType

  if (isOut) {
    iconBg = 'bg-orange-100 dark:bg-orange-950/30'
    iconColor = 'text-[var(--orange)]'
    label = 'יציאה'
    IconComponent = ArrowUpRight
  } else if (isIn) {
    iconBg = 'bg-green-100 dark:bg-green-950/30'
    iconColor = 'text-[var(--green)]'
    label = 'כניסה'
    IconComponent = ArrowDownLeft
  } else {
    iconBg = 'bg-gray-100 dark:bg-gray-800/40'
    iconColor = 'text-[var(--text-muted)]'
    label = event.type
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

// ─── Absence request item ─────────────────────────────────────────────────────

function RequestItem({ request }: { request: AbsenceRequest }) {
  const dateLabel =
    request.endDate && request.endDate !== request.date
      ? `${formatDate(request.date)} — ${formatDate(request.endDate)}`
      : formatDate(request.date)

  let iconBg: string
  let iconColor: string
  let statusLabel: string
  let IconComponent: React.ElementType

  switch (request.status) {
    case 'PENDING':
      iconBg = 'bg-yellow-100 dark:bg-yellow-950/30'
      iconColor = 'text-[var(--orange)]'
      statusLabel = 'בקשה ממתינה'
      IconComponent = Clock
      break
    case 'APPROVED':
      iconBg = 'bg-green-100 dark:bg-green-950/30'
      iconColor = 'text-[var(--green)]'
      statusLabel = 'בקשה אושרה'
      IconComponent = CheckCircle
      break
    case 'REJECTED':
      iconBg = 'bg-red-100 dark:bg-red-950/30'
      iconColor = 'text-[var(--red)]'
      statusLabel = 'בקשה נדחתה'
      IconComponent = XCircle
      break
    case 'CANCELLED':
    default:
      iconBg = 'bg-gray-100 dark:bg-gray-800/40'
      iconColor = 'text-[var(--text-muted)]'
      statusLabel = 'בקשה בוטלה'
      IconComponent = XCircle
      break
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
              {request.isUrgent && (
                <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                  <AlertOctagon className="h-2.5 w-2.5" />
                  חריג
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">{dateLabel}</p>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3.5 w-3.5" />
              {request.startTime} — {request.endTime}
            </div>
            {request.reason && (
              <p className="mt-1 text-sm text-[var(--text-muted)]">{request.reason}</p>
            )}
            {request.adminNote && (
              <p className="mt-1.5 text-xs text-[var(--text-muted)] italic">
                הערת מנהל: {request.adminNote}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
