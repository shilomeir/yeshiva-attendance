import { useEffect, useState } from 'react'
import { CalendarIcon, Plus, Clock, CheckCircle, XCircle, AlertCircle, AlertOctagon, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import type { AbsenceRequest } from '@/types'

const STATUS_CONFIG = {
  PENDING: { label: 'ממתין לאישור', icon: AlertCircle, color: 'text-[var(--orange)]', variant: 'warning' as const },
  APPROVED: { label: 'אושר', icon: CheckCircle, color: 'text-[var(--green)]', variant: 'success' as const },
  REJECTED: { label: 'נדחה', icon: XCircle, color: 'text-[var(--red)]', variant: 'danger' as const },
  CANCELLED: { label: 'בוטל', icon: XCircle, color: 'text-[var(--text-muted)]', variant: 'secondary' as const },
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const monthNames = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ]
  return `${parseInt(day)} ב${monthNames[parseInt(month) - 1]} ${year}`
}

export function AbsenceRequestPage() {
  const { currentUser } = useAuthStore()
  const [requests, setRequests] = useState<AbsenceRequest[]>([])
  const [showForm, setShowForm] = useState(false)

  // Form fields
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('20:00')
  const [isUrgent, setIsUrgent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const endDateMin = startDate || todayStr()
  const isEndBeforeStart = endDate !== '' && startDate !== '' && endDate < startDate

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

  // Realtime subscription for own requests
  useEffect(() => {
    if (!currentUser) return
    const channel = supabase
      .channel(`student-requests-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests', filter: `studentId=eq.${currentUser.id}` }, () => {
        loadRequests()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !startDate || !reason || isEndBeforeStart) return

    setIsSubmitting(true)
    try {
      await api.createAbsenceRequest({
        studentId: currentUser.id,
        date: startDate,
        endDate: endDate && endDate !== startDate ? endDate : undefined,
        reason,
        startTime,
        endTime,
        isUrgent,
      })

      toast({
        title: isUrgent ? 'בקשה חריגה נשלחה' : 'הבקשה נשלחה בהצלחה',
        description: isUrgent
          ? 'הבקשה מסומנת כחריגה ותועבר לאישור מיידי'
          : 'מנהל הישיבה יאשר את הבקשה בהקדם',
      })

      setStartDate('')
      setEndDate('')
      setReason('')
      setStartTime('08:00')
      setEndTime('20:00')
      setIsUrgent(false)
      setShowForm(false)
      await loadRequests()
    } catch {
      toast({ title: 'שגיאה בשליחת הבקשה', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async (id: string) => {
    try {
      await api.cancelAbsenceRequest(id)
      toast({ title: 'הבקשה בוטלה' })
      setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: 'CANCELLED' as const } : r))
    } catch {
      toast({ title: 'שגיאה בביטול הבקשה', variant: 'destructive' })
    }
  }

  const canSubmit = startDate && reason && !isEndBeforeStart && !isSubmitting

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

              {/* Urgent toggle */}
              <button
                type="button"
                onClick={() => setIsUrgent((v) => !v)}
                className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isUrgent
                    ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/20 dark:text-orange-400'
                    : 'border-[var(--border)] bg-[var(--bg-2)] text-[var(--text-muted)] hover:border-orange-300'
                }`}
              >
                <AlertOctagon className={`h-5 w-5 ${isUrgent ? 'text-orange-500' : 'text-[var(--text-muted)]'}`} />
                <span>בקשה חריגה (דחופה)</span>
                {isUrgent && (
                  <span className="mr-auto rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white">
                    פעיל
                  </span>
                )}
              </button>

              {/* Urgent warning */}
              {isUrgent && (
                <div className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-700 dark:bg-orange-950/20 dark:text-orange-400">
                  ⚠️ בקשה חריגה מועברת לאישור מיידי של הנהלת הישיבה. יש להשתמש רק במקרים דחופים.
                </div>
              )}

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startDate">מתאריך</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    min={todayStr()}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      if (endDate && endDate < e.target.value) setEndDate('')
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="endDate">עד תאריך</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    min={endDateMin}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                  {isEndBeforeStart && (
                    <p className="text-xs text-[var(--red)]">תאריך חזרה לא יכול להיות לפני תאריך יציאה</p>
                  )}
                </div>
              </div>

              {/* Reason */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="reason">סיבה</Label>
                <Input
                  id="reason"
                  type="text"
                  placeholder="תאר את סיבת ההיעדרות..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
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
                disabled={!canSubmit}
                className={`w-full ${isUrgent ? 'bg-orange-500 hover:bg-orange-600' : ''}`}
              >
                {isSubmitting ? 'שולח...' : isUrgent ? 'שליחת בקשה חריגה' : 'שליחת בקשה'}
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
            const dateLabel =
              req.endDate && req.endDate !== req.date
                ? `${formatDate(req.date)} — ${formatDate(req.endDate)}`
                : formatDate(req.date)

            return (
              <Card key={req.id} className={req.isUrgent ? 'border-orange-300 dark:border-orange-700' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--text)]">{dateLabel}</p>
                        {req.isUrgent && (
                          <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                            <AlertOctagon className="h-2.5 w-2.5" />
                            חריגה
                          </span>
                        )}
                      </div>
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
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant={config.variant} className="flex items-center gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </Badge>
                      {(req.status === 'PENDING' || req.status === 'APPROVED') && (
                        <button
                          onClick={() => handleCancel(req.id)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-red-50 hover:text-[var(--red)] transition-colors dark:hover:bg-red-950/20"
                        >
                          <Trash2 className="h-3 w-3" />
                          ביטול
                        </button>
                      )}
                    </div>
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
