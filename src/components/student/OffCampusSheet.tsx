import { useState, useEffect } from 'react'
import { Loader2, AlertOctagon, Clock, User } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { scheduleReturn } from '@/lib/notifications/scheduleReturn'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import type { QuotaFullResult, DepartureSubmitResult } from '@/types'

function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function twoHoursLaterStr(): string {
  const d = new Date()
  d.setHours(d.getHours() + 2)
  // If it rolled past midnight, cap at 23:59 (same-day; user can set returnDate for multi-day)
  if (d.getDate() !== new Date().getDate()) d.setHours(23, 59, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatEndAt(isoStr: string): string {
  const d = new Date(isoStr)
  const todayStr = toDateInput(new Date())
  const depDateStr = toDateInput(d)
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return depDateStr === todayStr ? timeStr : `${timeStr} (${depDateStr})`
}

interface OffCampusSheetProps {
  open: boolean
  onClose: () => void
  onSuccess: (departureId: string) => void
}

type Stage = 'form' | 'submitting' | 'full'

export function OffCampusSheet({ open, onClose, onSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()

  const [stage, setStage] = useState<Stage>('form')
  const [reason, setReason] = useState('')
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [endTime, setEndTime] = useState(twoHoursLaterStr)
  const [returnDate, setReturnDate] = useState('')
  const [quotaInfo, setQuotaInfo] = useState<QuotaFullResult | null>(null)

  const todayStr = toDateInput(new Date())

  useEffect(() => {
    if (!open) {
      setStage('form')
      setReason('')
      setStartTime(nowTimeStr())
      setEndTime(twoHoursLaterStr())
      setReturnDate('')
      setQuotaInfo(null)
    }
  }, [open])

  const isMultiDay = returnDate !== '' && returnDate > todayStr
  const effectiveEndDate = isMultiDay ? returnDate : todayStr
  const isSubmitting = stage === 'submitting'
  const canSubmit = startTime && endTime && !isSubmitting

  const doSubmit = async (isUrgent: boolean, forcePending: boolean) => {
    if (!currentUser) return
    setStage('submitting')
    try {
      const startAt = new Date(`${todayStr}T${startTime}:00`).toISOString()
      const endAt = new Date(`${effectiveEndDate}T${endTime}:00`).toISOString()

      if (new Date(endAt) <= new Date(startAt)) {
        toast({ title: 'שגיאה', description: 'שעת החזרה חייבת להיות אחרי שעת היציאה', variant: 'destructive' })
        setStage(forcePending ? 'full' : 'form')
        return
      }

      const result = await api.submitDeparture({
        studentId: currentUser.id,
        startAt,
        endAt,
        reason: reason || null,
        isUrgent,
        forcePending,
      })

      if ('error' in result) {
        const r = result as { error: string; message?: string }
        toast({ title: 'שגיאה', description: r.message ?? r.error, variant: 'destructive' })
        setStage(forcePending ? 'full' : 'form')
        return
      }

      if ((result as QuotaFullResult).status === 'QUOTA_FULL') {
        setQuotaInfo(result as QuotaFullResult)
        setStage('full')
        return
      }

      const dep = result as DepartureSubmitResult
      const isApproved = dep.status === 'APPROVED' || dep.status === 'ACTIVE'
      toast({
        title: isApproved ? 'יציאה אושרה!' : 'הבקשה נשלחה לאישור',
        description: isApproved
          ? `חזרה צפויה בשעה ${endTime}${isMultiDay ? ` (${effectiveEndDate})` : ''}`
          : 'ממתינה לאישור מנהל',
      })

      if (isApproved) {
        scheduleReturn(currentUser.fullName, endAt).catch(() => {})
      }
      onSuccess(dep.id)
      onClose()
    } catch {
      toast({ title: 'שגיאה בשליחת הבקשה', variant: 'destructive' })
      setStage(forcePending ? 'full' : 'form')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !canSubmit) return
    doSubmit(false, false)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o && !isSubmitting) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="mb-4">
          <SheetTitle>בקשת יציאה מהישיבה</SheetTitle>
          <SheetDescription>
            {stage === 'full' ? 'הכיתה מלאה — בחר כיצד להגיש את הבקשה' : 'מלא את פרטי היציאה'}
          </SheetDescription>
        </SheetHeader>

        {/* ── Quota-full banner ──────────────────────────────────────── */}
        {stage === 'full' && quotaInfo && (
          <div className="flex flex-col gap-4">
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
                        {formatEndAt(s.endAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-sm text-[var(--red)]">
                {`אתה יכול לפנות אליהם כדי לבקש שיבטלו את ההרשמה שלהם וכך תפנה מקום בשבילך.`}
              </p>
            </div>

            <p className="text-sm text-center text-[var(--text-muted)]">
              האם בכל זאת אתה רוצה לבקש אישור?
            </p>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => doSubmit(false, true)}
                disabled={isSubmitting}
                variant="outline"
                className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'כן, בקש אישור'}
              </Button>
              <Button
                onClick={() => doSubmit(true, false)}
                disabled={isSubmitting}
                className="w-full bg-[var(--orange)] hover:bg-orange-600 text-white"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'בקשה חריגה (דחופה)'}
              </Button>
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full text-[var(--text-muted)]"
              >
                לא, ביטול
              </Button>
            </div>
          </div>
        )}

        {/* ── Departure form ─────────────────────────────────────────── */}
        {(stage === 'form' || stage === 'submitting') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="startTime">שעת יציאה</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="text-lg"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="endTime">שעת חזרה</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="text-lg"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="returnDate">תאריך חזרה (ריק = היום)</Label>
              <Input
                id="returnDate"
                type="date"
                value={returnDate}
                min={todayStr}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reason">סיבת היציאה (אופציונלי)</Label>
              <Input
                id="reason"
                type="text"
                placeholder="לדוגמה: ביקור משפחה, טיפול רפואי..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={isSubmitting}>
                ביטול
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-[var(--orange)] hover:bg-orange-600"
                disabled={!canSubmit}
              >
                {isSubmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin ml-2" />בודק...</>
                ) : (
                  'שלח בקשת יציאה'
                )}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
