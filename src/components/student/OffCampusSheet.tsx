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
import type { AbsenceQuotaResult } from '@/lib/api/types'

function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface OffCampusSheetProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  onCheckoutSuccess?: (eventId: string) => void
}

type Stage = 'form' | 'checking' | 'full' | 'submitting'

export function OffCampusSheet({ open, onClose, onSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()

  const [stage, setStage] = useState<Stage>('form')
  const [reason, setReason] = useState('')
  const [startTime, setStartTime] = useState(nowTimeStr)
  const [endTime, setEndTime] = useState('20:00')
  const [returnDate, setReturnDate] = useState('')   // empty = same day
  const [quotaInfo, setQuotaInfo] = useState<AbsenceQuotaResult | null>(null)

  const todayStr = toDateInput(new Date())

  // Reset form when sheet closes
  useEffect(() => {
    if (!open) {
      setStage('form')
      setReason('')
      setStartTime(nowTimeStr())
      setEndTime('20:00')
      setReturnDate('')
      setQuotaInfo(null)
    }
  }, [open])

  const isMultiDay = returnDate !== '' && returnDate > todayStr
  const effectiveEndDate = isMultiDay ? returnDate : todayStr
  const isSubmitting = stage === 'checking' || stage === 'submitting'
  const canSubmit = startTime && endTime && !isSubmitting

  const createRequest = async (isUrgent: boolean) => {
    if (!currentUser) return
    setStage('submitting')
    try {
      const req = await api.createAbsenceRequest({
        studentId: currentUser.id,
        date: todayStr,
        endDate: isMultiDay ? returnDate : undefined,
        reason: reason || (isUrgent ? 'בקשה חריגה' : 'יציאה'),
        startTime,
        endTime,
        isUrgent,
      })

      const isApproved = req.status === 'APPROVED'
      const description = isMultiDay
        ? `חזרה ב-${returnDate} בשעה ${endTime}`
        : `חזרה צפויה בשעה ${endTime}`

      toast({
        title: isApproved ? 'הבקשה אושרה' : 'הבקשה נשלחה לאישור',
        description: isApproved ? description : 'ממתינה לאישור מנהל',
      })

      if (isApproved) {
        // Schedule a local return reminder
        const returnISO = new Date(`${effectiveEndDate}T${endTime}:00`).toISOString()
        scheduleReturn(currentUser.fullName, returnISO).catch(() => {})
        onSuccess()
      }
      onClose()
    } catch {
      toast({ title: 'שגיאה בשליחת הבקשה', variant: 'destructive' })
      setStage('full') // stay on full-quota screen so user can retry
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || !canSubmit) return

    setStage('checking')
    try {
      const quota = await api.checkAbsenceQuota(
        currentUser.classId,
        todayStr,
        isMultiDay ? returnDate : null,
        startTime,
        endTime,
        currentUser.id,
      )

      if (quota.hasSpace) {
        // Space available — create and auto-approve
        setQuotaInfo(null)
        await createRequest(false)
      } else {
        // No space — show full-quota banner
        setQuotaInfo(quota)
        setStage('full')
      }
    } catch {
      toast({ title: 'שגיאה בבדיקת מכסה', variant: 'destructive' })
      setStage('form')
    }
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

        {/* ── Quota-full banner ───────────────────────────────── */}
        {stage === 'full' && quotaInfo && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
              <div className="flex items-start gap-2">
                <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--red)]" />
                <div>
                  <p className="font-bold text-[var(--red)]">אוי אוי אוי... נגמר המקום</p>
                  <p className="mt-0.5 text-sm text-[var(--red)]">
                    הכיתה מלאה — {quotaInfo.current} מתוך {quotaInfo.quota} מקומות תפוסים
                  </p>
                </div>
              </div>

              {quotaInfo.overlapping.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-red-100/60 px-3 py-2 dark:bg-red-900/20">
                  {quotaInfo.overlapping.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm text-[var(--red)]">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span>{s.studentName}</span>
                      </div>
                      <span className="flex items-center gap-1 text-xs opacity-75">
                        <Clock className="h-3 w-3" />
                        {s.endDate && s.endDate !== todayStr ? s.endDate : s.endTime}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-sm text-center text-[var(--text-muted)]">
              רוצה להגיש בקשה בכל זאת?
            </p>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => createRequest(false)}
                disabled={isSubmitting}
                variant="outline"
                className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'בקשה רגילה (ממתינה לאישור)'}
              </Button>
              <Button
                onClick={() => createRequest(true)}
                disabled={isSubmitting}
                className="w-full bg-[var(--orange)] hover:bg-orange-600 text-white"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'בקשה חריגה (דחופה)'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setStage('form')}
                disabled={isSubmitting}
                className="w-full text-[var(--text-muted)]"
              >
                חזור לטופס
              </Button>
            </div>
          </div>
        )}

        {/* ── Departure form ──────────────────────────────────── */}
        {(stage === 'form' || stage === 'checking') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* Departure + return times */}
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

            {/* Optional return date (multi-day) */}
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

            {/* Reason */}
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
                {stage === 'checking' ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />בודק...</>
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
