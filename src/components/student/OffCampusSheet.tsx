import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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

export function OffCampusSheet({ open, onClose, onSuccess }: OffCampusSheetProps) {
  const { currentUser } = useAuthStore()
  const [returnTime, setReturnTime] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return

    setIsSubmitting(true)

    try {
      // Get GPS position
      const gpsResult = await getCurrentPosition()

      let expectedReturn: string | null = null
      if (returnTime) {
        const today = new Date()
        const [hours, minutes] = returnTime.split(':').map(Number)
        today.setHours(hours, minutes, 0, 0)
        expectedReturn = today.toISOString()
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

      // Schedule return notification
      if (expectedReturn) {
        await scheduleReturn(currentUser.fullName, expectedReturn)
      }

      toast({
        title: 'היציאה נרשמה בהצלחה',
        description: returnTime ? `חזרה צפויה ב-${returnTime}` : 'יציאה נרשמה',
        variant: 'default',
      })

      setReturnTime('')
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to record departure:', error)
      toast({
        title: 'שגיאה ברישום היציאה',
        description: 'נסה שוב',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (isSubmitting) return
    setReturnTime('')
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="mb-6">
          <SheetTitle>יציאה מהישיבה</SheetTitle>
          <SheetDescription>הזן שעת חזרה צפויה (אופציונלי)</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Expected return time */}
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

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1" disabled={isSubmitting}>
              ביטול
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[var(--orange)] hover:bg-orange-600"
              disabled={isSubmitting}
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
