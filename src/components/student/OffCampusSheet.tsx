import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle, CalendarDays, Clock, AlertOctagon, User } from 'lucide-react'
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
import type { Student } from '@/types'

interface ClassmateInfo extends Student {
  expectedReturn: string | null
}

function formatReturnLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

interface OffCampusSheetProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  /** Called after a successful checkout — receives the eventId so the caller
   *  can hard-delete it if the student wants to cancel the departure. */
  onCheckoutSuccess?: (eventId: string) => void
}

type DepartureMode = 'today' | 'multiday'

function toDateInput(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Dynamic quota: ~3 slots per 25 students (rounds to nearest).
 *  Examples: 25→3, 26→3, 30→4, 50→6.
 *  Minimum is 1. Matches the server-side RPC formula. */
function calcQuota(classSize: number): number {
  return Math.max(1, Math.round((classSize * 3) / 25))
}

export function OffCampusSheet({ open, onClose, onSuccess, onCheckoutSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()

  const [mode, setMode] = useState<DepartureMode>('today')
  const [reason, setReason] = useState('')
  const [returnTime, setReturnTime] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [outsideCount, setOutsideCount] = useState<number | null>(null)
  const [quota, setQuota] = useState<number>(3)
  const [classmatesOutside, setClassmatesOutside] = useState<ClassmateInfo[]>([])

  // Fetch live quota counter when sheet opens
  useEffect(() => {
    if (!open || !currentUser) return

    // Fetch actual class size to compute quota dynamically
    api.getClassSize(currentUser.classId)
      .then((size) => setQuota(calcQuota(size)))
      .catch(() => setQuota(3)) // safe fallback

    api.getClassOutsideCount(currentUser.classId)
      .then((count) => {
        setOutsideCount(count)
        // If class is already full, pre-load classmates list with return times
        if (count >= quota) {
          api.getStudents({ filter: 'OFF_CAMPUS', classId: currentUser.classId })
            .then(async (students) => {
              const withReturn: ClassmateInfo[] = await Promise.all(
                students.map(async (s) => {
                  const events = await api.getEvents(s.id)
                  const lastCheckout = events
                    .filter((e) => e.type === 'CHECK_OUT')
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
                  return { ...s, expectedReturn: lastCheckout?.expectedReturn ?? null }
                })
              )
              setClassmatesOutside(withReturn)
            })
            .catch(() => setClassmatesOutside([]))
        }
      })
      .catch(() => setOutsideCount(null))
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
        // Use noon (12:00) as the base time so the UTC conversion never crosses
        // to the previous day (Israel is UTC+3, midnight local = 21:00 previous day UTC)
        const d = new Date(`${returnDate}T12:00:00`)
        if (returnTime) {
          const [h, m] = returnTime.split(':').map(Number)
          d.setHours(h, m, 0, 0)
        } else {
          d.setHours(23, 59, 0, 0)
        }
        expectedReturn = d.toISOString()
      }

      const result = await api.createCheckoutWithQuotaCheck(
        currentUser.id,
        currentUser.classId,
        currentUser.grade,
        reason || null,
        expectedReturn,
      )

      if (!result.success) {
        // Quota exceeded — show toast and load classmates list
        const current = result.current ?? 0
        const q = result.quota ?? quota
        toast({
          title: `הכיתה מלאה — ${current} מתוך ${q} מקומות תפוסים`,
          variant: 'destructive',
        })
        setOutsideCount(current)
        setQuota(q)
        // Load classmates who are outside with return times
        api.getStudents({ filter: 'OFF_CAMPUS', classId: currentUser.classId })
          .then(async (students) => {
            const withReturn: ClassmateInfo[] = await Promise.all(
              students.map(async (s) => {
                const events = await api.getEvents(s.id)
                const lastCheckout = events
                  .filter((e) => e.type === 'CHECK_OUT')
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
                return { ...s, expectedReturn: lastCheckout?.expectedReturn ?? null }
              })
            )
            setClassmatesOutside(withReturn)
          })
          .catch(() => setClassmatesOutside([]))
        return
      }

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
      const eventId = result.eventId ?? ''
      resetForm()
      onSuccess()
      if (eventId) onCheckoutSuccess?.(eventId)
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
    setClassmatesOutside([])
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
        <SheetHeader className="mb-4">
          <SheetTitle>יציאה מהישיבה</SheetTitle>
          <SheetDescription>בחר את סוג היציאה</SheetDescription>
        </SheetHeader>

        {/* Live quota counter */}
        {outsideCount !== null && !isFull && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-[var(--bg-2)] px-3 py-2 text-sm">
            <span className="text-[var(--text-muted)]">מקומות תפוסים</span>
            <span className="font-semibold text-[var(--text)]">
              {outsideCount} מתוך {quota}
            </span>
          </div>
        )}

        {/* Class full banner */}
        {isFull && (
          <div className="mb-5 flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
            <div className="flex items-start gap-2">
              <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--red)]" />
              <div>
                <p className="font-bold text-[var(--red)]">אוי אוי אוי... נגמר המקום</p>
                <p className="mt-0.5 text-sm text-[var(--red)]">
                  הכיתה מלאה — {outsideCount} מתוך {quota} מקומות תפוסים
                </p>
              </div>
            </div>

            {/* List of classmates currently outside */}
            {classmatesOutside.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-red-100/60 px-3 py-2 dark:bg-red-900/20">
                {classmatesOutside.map((s) => {
                  const returnLabel = formatReturnLabel(s.expectedReturn)
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm text-[var(--red)]">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span>{s.fullName}</span>
                      </div>
                      {returnLabel && (
                        <span className="flex items-center gap-1 text-xs opacity-75">
                          <Clock className="h-3 w-3" />
                          {returnLabel}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

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
