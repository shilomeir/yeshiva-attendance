import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle, CalendarDays, Clock } from 'lucide-react'
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
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import { scheduleReturn } from '@/lib/notifications/scheduleReturn'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'

interface OffCampusSheetProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type DepartureMode = 'today' | 'multiday'

/** Returns YYYY-MM-DD string for a Date (local timezone) */
function toDateInput(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function OffCampusSheet({ open, onClose, onSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()

  const [mode, setMode] = useState<DepartureMode>('today')
  const [returnTime, setReturnTime] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Date limits for multi-day
  const todayStr = toDateInput(new Date())
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 2)
  const maxDateStr = toDateInput(maxDate)

  // Is the selected date beyond the 2-day limit?
  const isDateTooFar = mode === 'multiday' && returnDate !== '' && returnDate > maxDateStr

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser || isDateTooFar) return

    setIsSubmitting(true)
    try {
      const gpsResult = await getCurrentPosition()

      let expectedReturn: string | null = null

      if (mode === 'today' && returnTime) {
        const d = new Date()
        const [h, m] = returnTime.split(':').map(Number)
        d.setHours(h, m, 0, 0)
        expectedReturn = d.toISOString()
      } else if (mode === 'multiday' && returnDate) {
        // Parse date parts to avoid timezone offset issues
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
        reason: null,
        expectedReturn,
        gpsLat: isGPSResult(gpsResult) ? gpsResult.lat : null,
        gpsLng: isGPSResult(gpsResult) ? gpsResult.lng : null,
        gpsStatus: gpsResult.status,
        distanceFromCampus: isGPSResult(gpsResult) ? gpsResult.distanceFromCampus : null,
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
    setReturnTime('')
    setReturnDate('')
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
                {/* Return date */}
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

                {/* Return time */}
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

              {/* Too-far warning banner */}
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
