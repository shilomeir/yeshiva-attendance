import { useEffect, useState, useCallback } from 'react'
import { CalendarIcon, Plus, Clock, CheckCircle, XCircle, AlertCircle, AlertOctagon, Trash2, User, Play } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import type { CalendarDeparture, DepartureStatus, QuotaFullResult, DepartureSubmitResult } from '@/types'

const STATUS_CONFIG: Record<DepartureStatus, { label: string; icon: React.ElementType; color: string; variant: 'warning' | 'success' | 'danger' | 'secondary' | 'default' }> = {
  PENDING:   { label: 'ממתין לאישור',    icon: AlertCircle,  color: 'text-[var(--orange)]',     variant: 'warning' },
  APPROVED:  { label: 'אושר',             icon: CheckCircle,  color: 'text-[var(--green)]',      variant: 'success' },
  ACTIVE:    { label: 'בתוקף — מחוץ',    icon: Play,         color: 'text-[var(--blue)]',       variant: 'default' },
  COMPLETED: { label: 'הסתיים',           icon: CheckCircle,  color: 'text-[var(--text-muted)]', variant: 'secondary' },
  REJECTED:  { label: 'נדחה',             icon: XCircle,      color: 'text-[var(--red)]',        variant: 'danger' },
  CANCELLED: { label: 'בוטל',             icon: XCircle,      color: 'text-[var(--text-muted)]', variant: 'secondary' },
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
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

export function AbsenceRequestPage() {
  const { currentUser } = useAuthStore()
  const [requests, setRequests] = useState<CalendarDeparture[]>([])
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
  const [quotaStage, setQuotaStage] = useState<'form' | 'full'>('form')
  const [quotaInfo, setQuotaInfo] = useState<QuotaFullResult | null>(null)

  const today = todayStr()
  const endDateMin = startDate || today
  const isEndBeforeStart = endDate !== '' && startDate !== '' && endDate < startDate

  const loadRequests = useCallback(async () => {
    if (!currentUser) return
    setIsLoading(true)
    try {
      const data = await api.listDepartures({ studentId: currentUser.id })
      setRequests(data)
    } catch (err) {
      console.error('Failed to load departures:', err)
    } finally {
      setIsLoading(false)
    }
  }, [currentUser?.id])

  useEffect(() => { loadRequests() }, [currentUser?.id])

  useDeparturesRealtime({ onAnyChange: loadRequests })

  const resetForm = () => {
    setStartDate('')
    setEndDate('')
    setReason('')
    setStartTime('08:00')
    setEndTime('20:00')
    setIsUrgent(false)
    setShowForm(false)
    setQuotaStage('form')
    setQuotaInfo(null)
  }

  const doSubmit = async (urgent: boolean, forcePending: boolean) => {
    if (!currentUser || !startDate || isEndBeforeStart) return
    setIsSubmitting(true)
    try {
      const effectiveEndDate = endDate && endDate !== startDate ? endDate : startDate
      const startAt = new Date(`${startDate}T${startTime}:00`).toISOString()
      const endAt = new Date(`${effectiveEndDate}T${endTime}:00`).toISOString()

      const result = await api.submitDeparture({
        studentId: currentUser.id,
        startAt,
        endAt,
        reason: reason || null,
        isUrgent: urgent,
        forcePending,
      })

      if ('error' in result) {
        toast({ title: 'שגיאה', description: (result as { error: string }).error, variant: 'destructive' })
        return
      }

      if ((result as QuotaFullResult).status === 'QUOTA_FULL') {
        setQuotaInfo(result as QuotaFullResult)
        setQuotaStage('full')
        setIsSubmitting(false)
        return
      }

      const dep = result as DepartureSubmitResult
      toast({
        title: urgent
          ? 'בקשה חריגה נשלחה לאישור'
          : dep.status === 'APPROVED' || dep.status === 'ACTIVE'
          ? 'הבקשה אושרה אוטומטית'
          : 'הבקשה נשלחה לאישור',
        description: dep.status === 'APPROVED' || dep.status === 'ACTIVE'
          ? `${startDate} · ${startTime}–${endTime}`
          : 'ממתינה לאישור מנהל',
      })
      resetForm()
      await loadRequests()
    } catch {
      toast({ title: 'שגיאה בשליחת הבקשה', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !startDate || isEndBeforeStart) return
    doSubmit(isUrgent, false)
  }

  const handleCancel = async (dep: CalendarDeparture) => {
    if (!currentUser) return
    try {
      if (dep.status === 'ACTIVE') {
        await api.returnDeparture(dep.id, currentUser.id)
        toast({ title: 'חזרה נרשמה', description: 'הסטטוס עודכן לבישיבה' })
      } else {
        await api.cancelDeparture(dep.id, currentUser.id, 'STUDENT')
        toast({ title: 'הבקשה בוטלה' })
      }
      setRequests((prev) => prev.filter((r) => r.id !== dep.id))
    } catch {
      toast({ title: 'שגיאה', variant: 'destructive' })
    }
  }

  const canSubmit = startDate && !isEndBeforeStart && !isSubmitting

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
            {/* ── Quota-full banner ── */}
            {quotaStage === 'full' && quotaInfo && (
              <div className="flex flex-col gap-4 mb-2">
                <div className="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
                  <div className="flex items-start gap-2">
                    <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--red)]" />
                    <div>
                      <p className="font-bold text-[var(--red)]">המקום נגמר!</p>
                      <p className="mt-0.5 text-sm text-[var(--red)]">
                        {`התלמידים שרשומים ביציאה מהכיתה שלך:`}
                      </p>
                    </div>
                  </div>
                  {quotaInfo.overlapping.length > 0 && (
                    <div className="flex flex-col gap-1.5 rounded-lg bg-red-100/60 px-3 py-2 dark:bg-red-900/20">
                      {quotaInfo.overlapping.map((s) => (
                        <div key={s.studentId} className="flex items-center justify-between gap-2 text-sm text-[var(--red)]">
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 shrink-0" />
                            <span>{s.studentName}</span>
                          </div>
                          <span className="flex items-center gap-1 text-xs opacity-75">
                            <Clock className="h-3 w-3" />
                            {getTimeStr(s.endAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-[var(--red)]">
                    אתה יכול לפנות אליהם כדי לבקש שיבטלו את ההרשמה שלהם.
                  </p>
                </div>
                <p className="text-sm text-center text-[var(--text-muted)]">האם בכל זאת אתה רוצה לבקש אישור?</p>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => doSubmit(false, true)} disabled={isSubmitting} variant="outline"
                    className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400">
                    כן, שלח לאישור מנהל
                  </Button>
                  <Button onClick={() => doSubmit(true, false)} disabled={isSubmitting}
                    className="w-full bg-[var(--orange)] hover:bg-orange-600 text-white">
                    בקשה חריגה (דחופה)
                  </Button>
                  <Button variant="ghost" onClick={() => { setQuotaStage('form'); setQuotaInfo(null) }}
                    disabled={isSubmitting} className="w-full text-[var(--text-muted)]">
                    חזור לטופס
                  </Button>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className={`flex flex-col gap-4 ${quotaStage === 'full' ? 'hidden' : ''}`}>
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
                  <span className="mr-auto rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white">פעיל</span>
                )}
              </button>

              {isUrgent && (
                <div className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-700 dark:bg-orange-950/20 dark:text-orange-400">
                  ⚠️ בקשה חריגה מועברת לאישור מיידי של הנהלת הישיבה. יש להשתמש רק במקרים דחופים.
                </div>
              )}

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startDate">מתאריך</Label>
                  <Input id="startDate" type="date" value={startDate} min={today}
                    onChange={(e) => { setStartDate(e.target.value); if (endDate && endDate < e.target.value) setEndDate('') }} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="endDate">עד תאריך</Label>
                  <Input id="endDate" type="date" value={endDate} min={endDateMin}
                    onChange={(e) => setEndDate(e.target.value)} />
                  {isEndBeforeStart && (
                    <p className="text-xs text-[var(--red)]">תאריך חזרה לא יכול להיות לפני תאריך יציאה</p>
                  )}
                </div>
              </div>

              {/* Reason */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="reason">סיבה (אופציונלי)</Label>
                <Input id="reason" type="text" placeholder="תאר את סיבת ההיעדרות..."
                  value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>

              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sTime">שעת יציאה</Label>
                  <Input id="sTime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="eTime">שעת חזרה</Label>
                  <Input id="eTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>

              <Button type="submit" disabled={!canSubmit}
                className={`w-full ${isUrgent ? 'bg-orange-500 hover:bg-orange-600' : ''}`}>
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
          {requests.map((dep) => {
            const config = STATUS_CONFIG[dep.status] ?? STATUS_CONFIG.CANCELLED
            const StatusIcon = config.icon
            const depDateStr = getDateStr(dep.start_at)
            const endDateStr = getDateStr(dep.end_at)
            const dateLabel = endDateStr !== depDateStr
              ? `${formatDateHebrew(dep.start_at)} — ${formatDateHebrew(dep.end_at)}`
              : formatDateHebrew(dep.start_at)
            const canCancel = dep.status === 'PENDING' || dep.status === 'APPROVED'
            const canReturn = dep.status === 'ACTIVE'

            return (
              <Card key={dep.id} className={dep.is_urgent ? 'border-orange-300 dark:border-orange-700' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--text)]">{dateLabel}</p>
                        {dep.is_urgent && (
                          <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/30">
                            <AlertOctagon className="h-2.5 w-2.5" />
                            חריגה
                          </span>
                        )}
                      </div>
                      {dep.reason && <p className="mt-0.5 text-sm text-[var(--text-muted)]">{dep.reason}</p>}
                      <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Clock className="h-3.5 w-3.5" />
                        {getTimeStr(dep.start_at)} — {getTimeStr(dep.end_at)}
                      </div>
                      {dep.admin_note && (
                        <p className="mt-1.5 text-xs text-[var(--text-muted)] italic">
                          הערת מנהל: {dep.admin_note}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant={config.variant} className="flex items-center gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </Badge>
                      {canCancel && (
                        <button onClick={() => handleCancel(dep)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-red-50 hover:text-[var(--red)] transition-colors dark:hover:bg-red-950/20">
                          <Trash2 className="h-3 w-3" />
                          ביטול
                        </button>
                      )}
                      {canReturn && (
                        <button onClick={() => handleCancel(dep)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--green)] hover:bg-green-50 transition-colors dark:hover:bg-green-950/20">
                          <CheckCircle className="h-3 w-3" />
                          חזרתי
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
