import { useEffect, useState } from 'react'
import { Send, CheckCircle, XCircle, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatSmsForDisplay } from '@/lib/sms/parser'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import type { SmsEvent } from '@/types'

export function SmsWebhookPanel() {
  const [rawMessage, setRawMessage] = useState('')
  const [phone, setPhone] = useState('')
  const [smsEvents, setSmsEvents] = useState<SmsEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [lastParsed, setLastParsed] = useState<SmsEvent | null>(null)

  const loadEvents = async () => {
    setIsLoading(true)
    try {
      const events = await api.getSmsEvents()
      setSmsEvents(events)
    } catch {
      console.error('Failed to load SMS events')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rawMessage.trim()) return

    setIsSending(true)
    try {
      const result = await api.createSmsEvent(rawMessage, phone || undefined)
      setLastParsed(result)
      setRawMessage('')
      await loadEvents()
    } catch {
      console.error('Failed to send SMS event')
    } finally {
      setIsSending(false)
    }
  }

  const getExampleMessages = () => [
    'יציאה 14:30 קניות',
    'יציאה 16:00 רופא',
    'יציאה 09:00 נסיעה הביתה',
    'חזרה',
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Simulator form */}
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-[var(--text)] mb-4">סימולציית SMS נכנס</h3>
          <form onSubmit={handleSend} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">מספר טלפון שולח (אופציונלי)</Label>
              <div className="relative">
                <Phone className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="050-1234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="ps-9"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="message">תוכן ה-SMS</Label>
              <div className="flex gap-2">
                <Input
                  id="message"
                  placeholder="יציאה 14:30 קניות"
                  value={rawMessage}
                  onChange={(e) => setRawMessage(e.target.value)}
                  className="flex-1"
                  dir="rtl"
                />
                <Button type="submit" disabled={!rawMessage || isSending}>
                  <Send className="h-4 w-4" />
                  {isSending ? 'שולח...' : 'שליחה'}
                </Button>
              </div>
            </div>

            {/* Example messages */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-[var(--text-muted)]">דוגמאות:</span>
              {getExampleMessages().map((msg) => (
                <button
                  key={msg}
                  type="button"
                  onClick={() => setRawMessage(msg)}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
                >
                  {msg}
                </button>
              ))}
            </div>
          </form>

          {/* Parse result */}
          {lastParsed && (
            <div className={`mt-4 rounded-lg border p-3 ${lastParsed.parsedCorrectly ? 'border-[var(--green)] bg-green-50 dark:bg-green-950/20' : 'border-[var(--red)] bg-red-50 dark:bg-red-950/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                {lastParsed.parsedCorrectly ? (
                  <CheckCircle className="h-4 w-4 text-[var(--green)]" />
                ) : (
                  <XCircle className="h-4 w-4 text-[var(--red)]" />
                )}
                <span className="text-sm font-medium text-[var(--text)]">
                  {lastParsed.parsedCorrectly ? 'פורסר בהצלחה' : 'לא ניתן לפרסר'}
                </span>
              </div>
              {lastParsed.parsedCorrectly && lastParsed.parsedType && (
                <p className="text-sm text-[var(--text-muted)]">
                  {formatSmsForDisplay({
                    type: lastParsed.parsedType,
                    time: lastParsed.parsedTime,
                    reason: lastParsed.parsedReason,
                  })}
                </p>
              )}
              {!lastParsed.studentId && (
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  לא נמצא תלמיד עם מספר הטלפון הזה
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMS history */}
      <div>
        <h3 className="font-semibold text-[var(--text)] mb-3">
          היסטוריית SMS ({smsEvents.length})
        </h3>
        {isLoading ? (
          <p className="text-[var(--text-muted)] text-sm">טוען...</p>
        ) : smsEvents.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">אין הודעות SMS</p>
        ) : (
          <div className="flex flex-col gap-2">
            {smsEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="mt-0.5">
                  {event.parsedCorrectly ? (
                    <CheckCircle className="h-4 w-4 text-[var(--green)]" />
                  ) : (
                    <XCircle className="h-4 w-4 text-[var(--red)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-[var(--text)] truncate">
                    {event.rawMessage}
                  </p>
                  {event.parsedCorrectly && event.parsedType && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {formatSmsForDisplay({
                        type: event.parsedType,
                        time: event.parsedTime,
                        reason: event.parsedReason,
                      })}
                    </p>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {formatDateTimeHebrew(event.timestamp)}
                  </p>
                </div>
                <Badge variant={event.parsedCorrectly ? 'success' : 'danger'} className="shrink-0">
                  {event.parsedCorrectly ? 'תקין' : 'שגיאה'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
