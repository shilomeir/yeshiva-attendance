import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { CalendarIcon, Plus, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import type { AbsenceRequest } from '@/types'

const REASONS = [
  'נסיעה הביתה לסוף שבוע',
  'ביקור משפחה',
  'טיפול רפואי',
  'אירוע משפחתי',
  'אחר',
]

const STATUS_CONFIG = {
  PENDING: { label: 'ממתין לאישור', icon: AlertCircle, color: 'text-[var(--orange)]', variant: 'warning' as const },
  APPROVED: { label: 'אושר', icon: CheckCircle, color: 'text-[var(--green)]', variant: 'success' as const },
  REJECTED: { label: 'נדחה', icon: XCircle, color: 'text-[var(--red)]', variant: 'danger' as const },
}

export function AbsenceRequestPage() {
  const { currentUser } = useAuthStore()
  const [requests, setRequests] = useState<AbsenceRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>()
  const [reason, setReason] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('20:00')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const loadRequests = async () => {
    if (!currentUser) return
    setIsLoading(true)
    try {
      const data = await api.getAbsenceRequests({ studentId: currentUser.id })
      setRequests(data)
    } catch (err) {
      console.error('Failed to load requests:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [currentUser?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !selectedDate || !reason) return

    setIsSubmitting(true)
    try {
      await api.createAbsenceRequest({
        studentId: currentUser.id,
        date: format(selectedDate, 'yyyy-MM-dd'),
        reason,
        startTime,
        endTime,
      })

      toast({ title: 'הבקשה נשלחה בהצלחה', description: 'מנהל הישיבה יאשר את הבקשה בהקדם' })

      setSelectedDate(undefined)
      setReason('')
      setStartTime('08:00')
      setEndTime('20:00')
      setShowForm(false)
      await loadRequests()
    } catch {
      toast({ title: 'שגיאה בשליחת הבקשה', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[var(--text)]">בקשות היעדרות</h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" />
          {showForm ? 'ביטול' : 'בקשה חדשה'}
        </Button>
      </div>

      {/* New request form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">הגשת בקשת היעדרות</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Date picker */}
              <div className="flex flex-col gap-2">
                <Label>תאריך</Label>
                <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date < new Date()}
                    locale={he}
                    className="w-full"
                  />
                </div>
                {selectedDate && (
                  <p className="flex items-center gap-1.5 text-sm text-[var(--blue)]">
                    <CalendarIcon className="h-4 w-4" />
                    {format(selectedDate, 'EEEE, d בMMMM yyyy', { locale: he })}
                  </p>
                )}
              </div>

              {/* Reason */}
              <div className="flex flex-col gap-2">
                <Label>סיבה</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="בחר סיבה..." />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="start">שעת יציאה</Label>
                  <Input
                    id="start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="end">שעת חזרה</Label>
                  <Input
                    id="end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={!selectedDate || !reason || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? 'שולח...' : 'שליחת בקשה'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Requests list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="text-[var(--text-muted)]">טוען בקשות...</div>
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <CalendarIcon className="h-10 w-10 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)]">אין בקשות היעדרות</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((req) => {
            const config = STATUS_CONFIG[req.status]
            const StatusIcon = config.icon
            return (
              <Card key={req.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--text)]">
                        {format(new Date(req.date), 'EEEE, d בMMMM', { locale: he })}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--text-muted)]">{req.reason}</p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Clock className="h-3.5 w-3.5" />
                        {req.startTime} — {req.endTime}
                      </div>
                      {req.adminNote && (
                        <p className="mt-1.5 text-xs text-[var(--text-muted)] italic">
                          הערת מנהל: {req.adminNote}
                        </p>
                      )}
                    </div>
                    <Badge variant={config.variant} className="flex items-center gap-1 shrink-0">
                      <StatusIcon className="h-3 w-3" />
                      {config.label}
                    </Badge>
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
