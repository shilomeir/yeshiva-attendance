import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, Clock, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import type { Event } from '@/types'

export function HistoryPage() {
  const { currentUser } = useAuthStore()
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return
      setIsLoading(true)
      try {
        const data = await api.getEvents(currentUser.id)
        setEvents(data)
      } catch (err) {
        console.error('Failed to load events:', err)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [currentUser?.id])

  return (
    <div className="flex flex-col gap-4 p-4 pt-6">
      <h2 className="text-xl font-bold text-[var(--text)]">היסטוריית נוכחות</h2>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="text-[var(--text-muted)]">טוען היסטוריה...</div>
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Clock className="h-10 w-10 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">אין היסטוריה זמינה</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => {
            const isOut = event.type === 'CHECK_OUT'
            return (
              <Card key={event.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        isOut
                          ? 'bg-orange-100 text-[var(--orange)] dark:bg-orange-950/30'
                          : 'bg-green-100 text-[var(--green)] dark:bg-green-950/30'
                      }`}
                    >
                      {isOut ? (
                        <ArrowUpRight className="h-5 w-5" />
                      ) : (
                        <ArrowDownLeft className="h-5 w-5" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--text)]">
                        {isOut ? 'יציאה' : 'כניסה'}
                        {event.reason && ` — ${event.reason}`}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                        {formatDateTimeHebrew(event.timestamp)}
                      </p>
                      {event.expectedReturn && isOut && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                          <Clock className="h-3.5 w-3.5" />
                          חזרה צפויה: {formatDateTimeHebrew(event.expectedReturn)}
                        </p>
                      )}
                      {event.gpsStatus === 'GRANTED' && event.distanceFromCampus !== null && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                          <MapPin className="h-3.5 w-3.5" />
                          {event.distanceFromCampus < 50
                            ? 'בקמפוס'
                            : `${event.distanceFromCampus} מ׳ מהישיבה`}
                        </p>
                      )}
                    </div>

                    {/* Sync indicator */}
                    <div
                      className={`h-2 w-2 shrink-0 rounded-full mt-1.5 ${
                        event.syncedAt ? 'bg-[var(--green)]' : 'bg-[var(--border)]'
                      }`}
                      title={event.syncedAt ? 'מסונכרן' : 'ממתין לסנכרון'}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
