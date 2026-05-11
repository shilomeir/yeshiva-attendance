import { useEffect, useState, useCallback } from 'react'
import { CalendarIcon, Plus, Clock, CheckCircle, XCircle, AlertCircle, AlertOctagon, Trash2, User, Play, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import type { CalendarDeparture, DepartureStatus, QuotaFullResult, DepartureSubmitResult } from '@/types'

const STATUS_CONFIG: Record<DepartureStatus, {
  label: string
  icon: React.ElementType
  accentColor: string
  bgColor: string
  textColor: string
}> = {
  PENDING:   { label: 'ממתין לאישור', icon: AlertCircle,  accentColor: 'var(--orange)', bgColor: 'rgba(249,115,22,0.1)',  textColor: '#ea580c' },
  APPROVED:  { label: 'אושר',          icon: CheckCircle,  accentColor: '#3b82f6',        bgColor: 'rgba(59,130,246,0.1)', textColor: '#2563eb' },
  ACTIVE:    { label: 'בתוקף — בחוץ', icon: Play,         accentColor: 'var(--orange)', bgColor: 'rgba(249,115,22,0.1)',  textColor: '#ea580c' },
  COMPLETED: { label: 'הסתיים',        icon: CheckCircle,  accentColor: 'var(--green)',   bgColor: 'rgba(34,197,94,0.1)',  textColor: '#16a34a' },
  REJECTED:  { label: 'נדחה',          icon: XCircle,      accentColor: 'var(--red)',      bgColor: 'rgba(239,68,68,0.1)', textColor: '#dc2626' },
  CANCELLED: { label: 'בוטל',          icon: XCircle,      accentColor: 'var(--text-muted)', bgColor: 'rgba(100,116,139,0.08)', textColor: 'var(--text-muted)' },
}

const FILTER_OPTIONS: { value: 'all' | DepartureStatus; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'PENDING', label: 'ממתין' },
  { value: 'APPROVED', label: 'אושר' },
  { value: 'ACTIVE', label: 'פעיל' },
  { value: 'COMPLETED', label: 'הסתיים' },
  { value: 'REJECTED', label: 'נדחה' },
]

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
  const [activeFilter, setActiveFilter] = useState<'all' | DepartureStatus>('all')

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
        const r = result as { error: string; message?: string }
        const description = r.error === 'DUPLICATE_DEPARTURE'
          ? 'יש לך בקשת יציאה פעילה לאותה תקופה'
          : (r.message ?? r.error)
        toast({ title: 'שגיאה', description, variant: 'destructive' })
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

  const filteredRequests = activeFilter === 'all'
    ? requests
    : requests.filter((r) => r.status === activeFilter)

  const activeCount = requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED' || r.status === 'ACTIVE').length

  return (
    <div className="flex flex-col gap-0" dir="rtl">

      {/* ── Hero banner ── */}
      <div style={{
        margin: '16px 16px 0',
        borderRadius: 24,
        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%)',
        padding: '20px 20px 18px',
        boxShadow: '0 12px 32px -8px rgba(37,99,235,0.4), 0 1px 0 rgba(255,255,255,0.15) inset',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background blob */}
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -30, left: -20, width: 120, height: 120,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)',
          pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 12,
                background: 'rgba(255,255,255,0.18)',
                display: 'grid', placeItems: 'center',
                backdropFilter: 'blur(8px)',
              }}>
                <FileText style={{ width: 16, height: 16, color: '#fff' }} />
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>בקשות יציאה</h2>
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
              {activeCount > 0 ? `${activeCount} בקשות פעילות` : 'אין בקשות פעילות'}
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px',
              borderRadius: 14,
              background: showForm ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.92)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              color: showForm ? '#fff' : '#2563eb',
              boxShadow: showForm ? 'none' : '0 4px 12px rgba(0,0,0,0.15)',
              transition: 'all 0.2s ease',
              flexShrink: 0,
            }}
          >
            {showForm ? (
              <>
                <X style={{ width: 14, height: 14 }} />
                ביטול
              </>
            ) : (
              <>
                <Plus style={{ width: 14, height: 14 }} />
                בקשה חדשה
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── New request form ── */}
      {showForm && (
        <div
          className="animate-slide-up"
          style={{
            margin: '12px 16px 0',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.78)',
            border: '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 8px 24px rgba(15,23,42,0.1)',
            backdropFilter: 'blur(16px)',
            padding: '20px',
          }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 16 }}>
            הגשת בקשת יציאה
          </h3>

          {/* Quota-full state */}
          {quotaStage === 'full' && quotaInfo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
              <div style={{
                borderRadius: 16,
                border: '1px solid rgba(249,115,22,0.3)',
                background: 'rgba(249,115,22,0.06)',
                padding: '14px',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <AlertOctagon style={{ width: 20, height: 20, color: 'var(--orange)', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                      מכסת היציאות בכיתה מלאה
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      ניתן להגיש בקשה חריגה (דחופה) בלבד
                    </p>
                  </div>
                </div>
                {quotaInfo.overlapping.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>תלמידים שיצאו כרגע:</p>
                    <div style={{
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.5)',
                      padding: '8px 10px',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      {quotaInfo.overlapping.map((s) => (
                        <div key={s.studentId} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <User style={{ width: 12, height: 12, color: 'var(--text-muted)', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.studentName}
                            </span>
                          </div>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                            <Clock style={{ width: 10, height: 10 }} />
                            {getTimeStr(s.endAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => doSubmit(true, false)}
                disabled={isSubmitting}
                style={{
                  width: '100%', padding: '12px',
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #fb923c, #ea580c)',
                  border: 'none',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: isSubmitting ? 'default' : 'pointer',
                  opacity: isSubmitting ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 6px 18px rgba(234,88,12,0.4)',
                }}
              >
                <AlertOctagon style={{ width: 16, height: 16 }} />
                בקשה חריגה (דחופה)
              </button>

              <button
                onClick={() => { setQuotaStage('form'); setQuotaInfo(null) }}
                disabled={isSubmitting}
                style={{
                  width: '100%', padding: '10px',
                  borderRadius: 12, border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                חזור לטופס
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: quotaStage === 'full' ? 'none' : 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Urgent toggle */}
            <button
              type="button"
              onClick={() => setIsUrgent((v) => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                borderRadius: 14, border: `2px solid ${isUrgent ? 'rgba(249,115,22,0.6)' : 'var(--border)'}`,
                padding: '10px 14px',
                background: isUrgent ? 'rgba(249,115,22,0.08)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <AlertOctagon style={{ width: 18, height: 18, color: isUrgent ? 'var(--orange)' : 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: isUrgent ? '#ea580c' : 'var(--text-muted)', flex: 1, textAlign: 'right' }}>
                בקשה חריגה (דחופה)
              </span>
              {isUrgent && (
                <span style={{
                  borderRadius: 999,
                  background: 'var(--orange)',
                  color: '#fff', fontSize: 10, fontWeight: 700,
                  padding: '2px 8px',
                }}>פעיל</span>
              )}
            </button>

            {isUrgent && (
              <div style={{
                borderRadius: 12,
                border: '1px solid rgba(249,115,22,0.25)',
                background: 'rgba(249,115,22,0.06)',
                padding: '10px 12px',
                fontSize: 12, color: '#ea580c',
              }}>
                ⚠️ בקשה חריגה מועברת לאישור מיידי של הנהלת הישיבה. יש להשתמש רק במקרים דחופים.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Label htmlFor="startDate" style={{ fontSize: 12 }}>מתאריך</Label>
                <Input id="startDate" type="date" value={startDate} min={today}
                  onChange={(e) => { setStartDate(e.target.value); if (endDate && endDate < e.target.value) setEndDate('') }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Label htmlFor="endDate" style={{ fontSize: 12 }}>עד תאריך</Label>
                <Input id="endDate" type="date" value={endDate} min={endDateMin}
                  onChange={(e) => setEndDate(e.target.value)} />
                {isEndBeforeStart && (
                  <p style={{ fontSize: 10, color: 'var(--red)' }}>תאריך חזרה לא יכול להיות לפני תאריך יציאה</p>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="reason" style={{ fontSize: 12 }}>סיבה (אופציונלי)</Label>
              <Input id="reason" type="text" placeholder="תאר את סיבת ההיעדרות..."
                value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Label htmlFor="sTime" style={{ fontSize: 12 }}>שעת יציאה</Label>
                <Input id="sTime" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Label htmlFor="eTime" style={{ fontSize: 12 }}>שעת חזרה</Label>
                <Input id="eTime" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                width: '100%', padding: '13px',
                borderRadius: 14,
                background: isUrgent
                  ? 'linear-gradient(135deg, #fb923c, #ea580c)'
                  : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                border: 'none',
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'default',
                opacity: canSubmit ? 1 : 0.5,
                boxShadow: isUrgent
                  ? '0 6px 18px rgba(234,88,12,0.35)'
                  : '0 6px 18px rgba(37,99,235,0.35)',
              }}
            >
              {isSubmitting ? 'שולח...' : isUrgent ? 'שליחת בקשה חריגה' : 'שליחת בקשה'}
            </button>
          </form>
        </div>
      )}

      {/* ── Filter chips ── */}
      {!isLoading && requests.length > 0 && (
        <div
          style={{
            display: 'flex', gap: 8, overflowX: 'auto',
            padding: '12px 16px 0',
            scrollbarWidth: 'none',
          }}
          className="[&::-webkit-scrollbar]:hidden"
        >
          {FILTER_OPTIONS.map((opt) => {
            const count = opt.value === 'all' ? requests.length : requests.filter((r) => r.status === opt.value).length
            if (count === 0 && opt.value !== 'all') return null
            const isActive = activeFilter === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setActiveFilter(opt.value)}
                style={{
                  flexShrink: 0,
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: `1.5px solid ${isActive ? '#3b82f6' : 'rgba(15,23,42,0.1)'}`,
                  background: isActive ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.6)',
                  color: isActive ? '#2563eb' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {opt.label}
                <span style={{
                  fontSize: 10,
                  background: isActive ? '#3b82f6' : 'rgba(15,23,42,0.12)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  borderRadius: 999, padding: '1px 5px',
                  fontWeight: 800,
                }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Requests list ── */}
      <div style={{ padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>טוען בקשות...</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            padding: '40px 16px', textAlign: 'center',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(15,23,42,0.06)',
            backdropFilter: 'blur(12px)',
          }}>
            <CalendarIcon style={{ width: 40, height: 40, color: 'var(--text-muted)', opacity: 0.5 }} />
            <p style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500 }}>
              {activeFilter === 'all' ? 'אין בקשות היעדרות' : 'אין בקשות בסינון זה'}
            </p>
          </div>
        ) : (
          filteredRequests.map((dep) => {
            const config = STATUS_CONFIG[dep.status] ?? STATUS_CONFIG.CANCELLED
            const StatusIcon = config.icon
            const depDateStr = getDateStr(dep.start_at)
            const endDateStr = getDateStr(dep.end_at)
            const isMultiDay = endDateStr !== depDateStr
            const dateLabel = isMultiDay
              ? `${formatDateHebrew(dep.start_at)} — ${formatDateHebrew(dep.end_at)}`
              : formatDateHebrew(dep.start_at)
            const canCancel = dep.status === 'PENDING' || dep.status === 'APPROVED'
            const canReturn = dep.status === 'ACTIVE'

            return (
              <div
                key={dep.id}
                style={{
                  borderRadius: 18,
                  background: 'rgba(255,255,255,0.75)',
                  border: '1px solid rgba(255,255,255,0.9)',
                  boxShadow: '0 2px 12px rgba(15,23,42,0.07)',
                  backdropFilter: 'blur(12px)',
                  padding: '14px',
                  borderInlineStart: `3px solid ${config.accentColor}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Date and tags */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{dateLabel}</span>
                      {dep.is_urgent && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          borderRadius: 999,
                          background: 'rgba(249,115,22,0.12)',
                          padding: '2px 7px',
                          fontSize: 10, fontWeight: 800, color: 'var(--orange)',
                        }}>
                          <AlertOctagon style={{ width: 9, height: 9 }} />
                          חריגה
                        </span>
                      )}
                    </div>

                    {/* Time */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock style={{ width: 11, height: 11, color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {getTimeStr(dep.start_at)} — {getTimeStr(dep.end_at)}
                      </span>
                    </div>

                    {dep.reason && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{dep.reason}</p>
                    )}
                    {dep.admin_note && (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                        הערת מנהל: {dep.admin_note}
                      </p>
                    )}
                  </div>

                  {/* Status + actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                    {/* Status badge */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: config.bgColor,
                      fontSize: 11, fontWeight: 700, color: config.textColor,
                    }}>
                      <StatusIcon style={{ width: 11, height: 11 }} />
                      {config.label}
                    </div>

                    {/* Cancel */}
                    {canCancel && (
                      <button
                        onClick={() => handleCancel(dep)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          borderRadius: 8, border: 'none',
                          background: 'rgba(239,68,68,0.08)',
                          padding: '4px 8px',
                          fontSize: 11, fontWeight: 600, color: 'var(--red)',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 style={{ width: 11, height: 11 }} />
                        ביטול
                      </button>
                    )}

                    {/* Return */}
                    {canReturn && (
                      <button
                        onClick={() => handleCancel(dep)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          borderRadius: 8, border: 'none',
                          background: 'rgba(34,197,94,0.1)',
                          padding: '4px 8px',
                          fontSize: 11, fontWeight: 600, color: 'var(--green)',
                          cursor: 'pointer',
                        }}
                      >
                        <CheckCircle style={{ width: 11, height: 11 }} />
                        חזרתי
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
