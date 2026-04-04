import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle, CalendarDays, Clock, AlertOctagon } from 'lucide-react'
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
import { GRADE_LEVELS } from '@/lib/constants/grades'

interface OffCampusSheetProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type DepartureMode = 'today' | 'multiday'

function toDateInput(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getQuotaForGrade(gradeName: string): number {
  const level = GRADE_LEVELS.find((g) => g.name === gradeName)
  if (!level) return 3
  return level.capacity >= 50 ? 6 : 3
}

export function OffCampusSheet({ open, onClose, onSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()

  const [mode, setMode] = useState<DepartureMode>('today')
  const [reason, setReason] = useState('')
  const [returnTime, setReturnTime] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [outsideCount, setOutsideCount] = useState<number | null>(null)
  const [quota, setQuota] = useState<number>(3)

  // Check quota when sheet opens
  useEffect(() => {
    if (!open || !currentUser) return
    const q = getQuotaForGrade(currentUser.grade)
    setQuota(q)
    api.getClassOutsideCount(currentUser.classId).then(setOutsideCount).catch(() => setOutsideCount(null))
  }, [open, currentUser])

  const isFull = outsideCount !== null && outsideCount >= quota

  const todayStr = toDateInput(new Date())
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 2)
  const maxDateStr = toDateInput(maxDate)

  const isDateTooFar = mode === 'multiday' && returnDate !== '' && returnDate > maxDateStr

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || isDateTooFar) return

    setIsSubmitting(true)
    try {
      // GPS is collected ONLY during admin's ביקורת פנימית — not during student departures
      let expectedReturn: string | null = null

      if (mode === 'today' && returnTime) {
        const d = new Date()
        const [h, m] = returnTime.split(':').map(Number)
        d.setHours(h, m, 0, 0)
        expectedReturn = d.toISOString()
      } else if (mode === 'multiday' && returnDate) {
        const [year, month, day] = returnDate.split('-').map(Number)
        const d = new Date(year, month - 1, day)
        if (returnTime) {
          const [h, m] = returnTime.split(':').map(Number)
          d.setHours(h, m, 0, 0)
        } else {
          d.setHours(23, 59, 0, 0)
        }
        expectedReturn = d.toISOString()
      }

      await api.createEvent({
        studentId: currentUser.id,
        type: 'CHECK_OUT',
        reason: reason || null,
        expectedReturn,
        gpsLat: null,
        gpsLng: null,
        gpsStatus: 'PENDING',
        distanceFromCampus: null,
      })

      if (expectedReturn) {
        await scheduleReturn(currentUser.fullName, expectedReturn)
      }

      const description =
        mode === 'multiday' && returnDate
          ? `חזרה צפויה ב-${returnDate}${returnTime ? ` בשעה ${returnTime}` : ''}`
          : returnTime
          ? `חזרה צפויה ב-${returnTime}`
          : 'יציאה נרשמה'

      toast({ title: 'היציאה נרשמה בהצלחה', description, variant: 'default' })
      resetForm()
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to record departure:', error)
      toast({ title: 'שגיאה ברישום היציאה', description: 'נסה שוב', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setMode('today')
    setReason('')
    setReturnTime('')
    setReturnDate('')
    setOutsideCount(null)
  }

  const handleClose = () => {
    if (isSubmitting) return
    resetForm()
    onClose()
  }

  const handleGoToRequests = () => {
    handleClose()
    navigate('/student/requests')
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="mb-6">
          <SheetTitle>יציאה מהישיבה</SheetTitle>
          <SheetDescription>בחר את סוג היציאה</SheetDescription>
        </SheetHeader>

        {/* Class full banner */}
        {isFull && (
          <div className="mb-5 flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
            <div className="flex items-start gap-2">
              <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--red)]" />
              <div>
                <p className="font-bold text-[var(--red)]">אוי אוי אוי... נגמר המקום</p>
                <p className="mt-0.5 text-sm text-[var(--red)]">
                  הכיתה מלאה — {outsideCount} מתוך {quota} חריגים כבר יצאו
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleGoToRequests}
              className="w-full bg-[var(--orange)] text-white hover:bg-orange-600"
            >
              הגשת בקשה חריגה (דחופה)
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Mode toggle */}
          <div className="flex rounded-lg border border-[var(--border)] p-1 gap-1">
            <button
              type="button"
              onClick={() => setMode('today')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'today'
                  ? 'bg-[var(--blue)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-2)]'
              }`}
            >
              חזרה היום
            </button>
            <button
              type="button"
              onClick={() => setMode('multiday')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'multiday'
                  ? 'bg-[var(--blue)] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-2)]'
              }`}
            >
              יציאה לכמה ימים
            </button>
          </div>

          {/* Reason (free text) */}
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

          {/* ── Today mode ── */}
          {mode === 'today' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="returnTime">שעת חזרה צפויה (אופציונלי)</Label>
              <Input
                id="returnTime"
                type="time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
                className="text-lg"
              />
            </div>
          )}

          {/* ── Multi-day mode ── */}
          {mode === 'multiday' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="returnDate" className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    תאריך חזרה
                  </Label>
                  <Input
                    id="returnDate"
                    type="date"
                    value={returnDate}
                    min={todayStr}
                    onChange={(e) => setReturnDate(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="returnTimeMD" className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    שעת חזרה (אופציונלי)
                  </Label>
                  <Input
                    id="returnTimeMD"
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                  />
                </div>
              </div>

              {isDateTooFar && (
                <div className="flex flex-col gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--orange)]" />
                    <p className="text-sm font-medium leading-snug text-[var(--orange)]">
                      ליציאה של יותר מיומיים נדרשת הגשת בקשת היעדרות רשמית
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleGoToRequests}
                    className="w-full bg-[var(--orange)] text-white hover:bg-orange-600"
                  >
                    מעבר לטופס בקשת היעדרות
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1"
              disabled={isSubmitting}
            >
              ביטול
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[var(--orange)] hover:bg-orange-600"
              disabled={
                isSubmitting ||
                isFull ||
                !!isDateTooFar ||
                (mode === 'multiday' && returnDate === '')
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  רושם...
                </>
              ) : (
                'אישור יציאה'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
