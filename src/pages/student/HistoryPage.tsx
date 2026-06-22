import { useEffect, useState, useCallback } from 'react'
import { ArrowUpRight, ArrowDownLeft, Clock, CheckCircle, XCircle, AlertOctagon, Activity, CalendarIcon, Play } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Event, CalendarDeparture } from '@/types'

type TimelineItem =
  | { kind: 'event'; data: Event; sortKey: string }
  | { kind: 'departure'; data: CalendarDeparture; sortKey: string }

function formatDateHebrewFull(isoStr: string): string {
  const d = new Date(isoStr)
  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ]
  return `יום ${dayNames[d.getDay()]}, ${d.getDate()} ב${monthNames[d.getMonth()]}`
}

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

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10)
}

function isYesterday(dateStr: string): boolean {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return dateStr === yesterday.toISOString().slice(0, 10)
}

function dateLabel(dateStr: string): string {
  if (isToday(dateStr)) return 'היום'
  if (isYesterday(dateStr)) return 'אתמול'
  return formatDateHebrewFull(`${dateStr}T12:00:00`)
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
      toast({ title: 'שגיאה בטעינת ציר הזמן', description: getErrorMessage(err, 'טעינת היסטוריית הפעולות נכשלה'), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [currentUser?.id])

  useEffect(() => { loadData() }, [currentUser?.id])

  useEffect(() => {
    if (!currentUser) return
    const ch = supabase
      .channel(`history-events-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `studentId=eq.${currentUser.id}` }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [currentUser?.id])

  useDeparturesRealtime({ studentId: currentUser?.id, onAnyChange: loadData })

  const auditEvents = events.filter((e) => e.type === 'OVERRIDE')

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

  // Group by date
  const grouped = new Map<string, TimelineItem[]>()
  for (const item of timeline) {
    const key = getDateStr(item.sortKey)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(item)
  }
  const groupedEntries = Array.from(grouped.entries()).sort((a, b) => b[0].localeCompare(a[0]))

  return (
    <div className="flex flex-col gap-0 p-4 pt-6" dir="rtl">
      {/* Page header */}
      <div className="mb-5 flex items-center gap-3">
        <div style={{
          width: 40, height: 40, borderRadius: 14,
          background: 'linear-gradient(135deg, var(--accent), #3730a3)',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          boxShadow: '0 6px 16px rgba(79,70,229,0.3)',
        }}>
          <CalendarIcon style={{ width: 18, height: 18, color: '#fff' }} />
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>ציר הזמן</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
            {timeline.length > 0 ? `${timeline.length} רשומות` : 'היסטוריית יציאות'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>טוען...</div>
        </div>
      ) : timeline.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 12, padding: '48px 16px', textAlign: 'center',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(15,23,42,0.06)',
          backdropFilter: 'blur(12px)',
        }}>
          <CalendarIcon style={{ width: 44, height: 44, color: 'var(--text-muted)', opacity: 0.5 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 15, fontWeight: 500 }}>אין פעילות עדיין</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, opacity: 0.7 }}>יציאות ואירועים יופיעו כאן</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedEntries.map(([dateStr, items]) => (
            <div key={dateStr} className="flex flex-col gap-2">
              {/* Day header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span className="day-chip">
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: isToday(dateStr) ? '#22c55e' : 'var(--text-muted)',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                  {dateLabel(dateStr)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
                  {items.length} {items.length === 1 ? 'רשומה' : 'רשומות'}
                </span>
              </div>

              {/* Items for this day */}
              <div className="flex flex-col gap-2">
                {items.map((item) => {
                  if (item.kind === 'event') {
                    return <EventItem key={`event-${item.data.id}`} event={item.data} />
                  }
                  return <DepartureItem key={`dep-${item.data.id}`} departure={item.data} />
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Event item ────────────────────────────────────────────────────────────────

function EventItem({ event }: { event: Event }) {
  let accentColor: string
  let iconBg: string
  let label: string
  let IconComponent: React.ElementType

  if (event.type === 'CHECK_OUT') {
    accentColor = 'var(--orange)'
    iconBg = 'rgba(249,115,22,0.12)'
    label = 'יציאה'
    IconComponent = ArrowUpRight
  } else if (event.type === 'CHECK_IN') {
    accentColor = 'var(--green)'
    iconBg = 'rgba(34,197,94,0.12)'
    label = 'כניסה'
    IconComponent = ArrowDownLeft
  } else {
    accentColor = 'var(--text-muted)'
    iconBg = 'rgba(100,116,139,0.1)'
    label = 'עדכון ידני'
    IconComponent = Activity
  }

  return (
    <div style={{
      borderRadius: 16,
      background: 'rgba(255,255,255,0.72)',
      border: '1px solid rgba(255,255,255,0.9)',
      boxShadow: '0 2px 12px rgba(15,23,42,0.07)',
      backdropFilter: 'blur(12px)',
      padding: '12px 14px',
      borderInlineStart: `3px solid ${accentColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 11, flexShrink: 0,
          background: iconBg,
          display: 'grid', placeItems: 'center',
          color: accentColor,
        }}>
          <IconComponent style={{ width: 16, height: 16 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            {label}
            {event.reason && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> — {event.reason}</span>}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {formatDateTimeHebrew(event.timestamp)}
          </p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>
          {getTimeStr(event.timestamp)}
        </span>
      </div>
    </div>
  )
}

// ── Departure item ─────────────────────────────────────────────────────────────

function DepartureItem({ departure: dep }: { departure: CalendarDeparture }) {
  const depDateStr = getDateStr(dep.start_at)
  const endDateStr = getDateStr(dep.end_at)
  const isMultiDay = endDateStr !== depDateStr
  const dateLabel2 = isMultiDay
    ? `${formatDateHebrew(dep.start_at)} — ${formatDateHebrew(dep.end_at)}`
    : formatDateHebrew(dep.start_at)

  let accentColor: string
  let iconBg: string
  let iconColor: string
  let statusLabel: string
  let IconComponent: React.ElementType

  switch (dep.status) {
    case 'PENDING':
      accentColor = 'var(--orange)'
      iconBg = 'rgba(249,115,22,0.12)'
      iconColor = 'var(--orange)'
      statusLabel = 'ממתינה לאישור'
      IconComponent = Clock
      break
    case 'APPROVED':
      accentColor = 'var(--info)'
      iconBg = 'var(--info-soft)'
      iconColor = 'var(--info)'
      statusLabel = 'אושרה'
      IconComponent = CheckCircle
      break
    case 'ACTIVE':
      accentColor = 'var(--orange)'
      iconBg = 'rgba(249,115,22,0.12)'
      iconColor = 'var(--orange)'
      statusLabel = 'בתוקף — בחוץ'
      IconComponent = Play
      break
    case 'COMPLETED':
      accentColor = 'var(--green)'
      iconBg = 'rgba(34,197,94,0.1)'
      iconColor = 'var(--green)'
      statusLabel = 'הסתיימה'
      IconComponent = CheckCircle
      break
    case 'REJECTED':
      accentColor = 'var(--red)'
      iconBg = 'rgba(239,68,68,0.1)'
      iconColor = 'var(--red)'
      statusLabel = 'נדחתה'
      IconComponent = XCircle
      break
    default:
      accentColor = 'var(--text-muted)'
      iconBg = 'rgba(100,116,139,0.08)'
      iconColor = 'var(--text-muted)'
      statusLabel = 'בוטלה'
      IconComponent = XCircle
  }

  return (
    <div style={{
      borderRadius: 16,
      background: 'rgba(255,255,255,0.72)',
      border: '1px solid rgba(255,255,255,0.9)',
      boxShadow: '0 2px 12px rgba(15,23,42,0.07)',
      backdropFilter: 'blur(12px)',
      padding: '12px 14px',
      borderInlineStart: `3px solid ${accentColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 11, flexShrink: 0,
          background: iconBg,
          display: 'grid', placeItems: 'center',
          color: iconColor,
        }}>
          <IconComponent style={{ width: 16, height: 16 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{statusLabel}</span>
            {dep.is_urgent && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                borderRadius: 999,
                background: 'rgba(249,115,22,0.12)',
                padding: '2px 6px',
                fontSize: 10, fontWeight: 800, color: 'var(--orange)',
              }}>
                <AlertOctagon style={{ width: 9, height: 9 }} />
                חריג
              </span>
            )}
          </div>
          {!isMultiDay && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <Clock style={{ width: 11, height: 11, color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {getTimeStr(dep.start_at)} — {getTimeStr(dep.end_at)}
              </span>
            </div>
          )}
          {isMultiDay && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{dateLabel2}</p>
          )}
          {dep.reason && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{dep.reason}</p>
          )}
          {dep.admin_note && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              הערת מנהל: {dep.admin_note}
            </p>
          )}
        </div>
        {!isMultiDay && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0, paddingTop: 2 }}>
            {getTimeStr(dep.start_at)}
          </span>
        )}
      </div>
    </div>
  )
}
