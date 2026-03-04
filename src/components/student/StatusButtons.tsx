import { useState } from 'react'
import { CheckCircle, LogOut, Loader2 } from 'lucide-react'
import { OffCampusSheet } from '@/components/student/OffCampusSheet'
import { api } from '@/lib/api'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils/cn'
import type { StudentStatus } from '@/types'

interface StatusButtonsProps {
  currentStatus: StudentStatus
  onStatusChange: (newStatus: StudentStatus) => void
}

export function StatusButtons({ currentStatus, onStatusChange }: StatusButtonsProps) {
  const { currentUser } = useAuthStore()
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [showOffCampusSheet, setShowOffCampusSheet] = useState(false)

  const isOnCampus = currentStatus === 'ON_CAMPUS'
  const isOffCampus = currentStatus === 'OFF_CAMPUS' || currentStatus === 'OVERDUE'

  const handleCheckIn = async () => {
    if (!currentUser || isCheckingIn) return
    setIsCheckingIn(true)

    try {
      const gpsResult = await getCurrentPosition()

      await api.createEvent({
        studentId: currentUser.id,
        type: 'CHECK_IN',
        gpsLat: isGPSResult(gpsResult) ? gpsResult.lat : null,
        gpsLng: isGPSResult(gpsResult) ? gpsResult.lng : null,
        gpsStatus: gpsResult.status,
        distanceFromCampus: isGPSResult(gpsResult) ? gpsResult.distanceFromCampus : null,
      })

      onStatusChange('ON_CAMPUS')

      toast({
        title: 'ברוך שובך!',
        description: 'החזרה לישיבה נרשמה בהצלחה',
      })
    } catch (error) {
      toast({
        title: 'שגיאה ברישום החזרה',
        description: 'נסה שוב',
        variant: 'destructive',
      })
    } finally {
      setIsCheckingIn(false)
    }
  }

  const handleCheckOut = () => {
    setShowOffCampusSheet(true)
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-4 h-full">
        {/* ON CAMPUS button */}
        <button
          onClick={isOnCampus ? undefined : handleCheckIn}
          disabled={isOnCampus || isCheckingIn}
          className={cn(
            'relative flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 transition-all active:scale-[0.98]',
            isOnCampus
              ? 'border-[var(--green)] bg-green-50 dark:bg-green-950/20 cursor-default shadow-lg'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--green)] hover:bg-green-50/50 dark:hover:bg-green-950/10 cursor-pointer shadow-sm hover:shadow-md',
            (isCheckingIn) && 'opacity-70 cursor-not-allowed'
          )}
        >
          {isCheckingIn ? (
            <Loader2 className="h-16 w-16 text-[var(--green)] animate-spin" />
          ) : (
            <CheckCircle
              className={cn(
                'h-16 w-16 transition-colors',
                isOnCampus ? 'text-[var(--green)]' : 'text-[var(--text-muted)]'
              )}
            />
          )}
          <div className="text-center">
            <p
              className={cn(
                'text-3xl font-bold',
                isOnCampus ? 'text-[var(--green)]' : 'text-[var(--text)]'
              )}
            >
              בישיבה
            </p>
            {isOnCampus && (
              <p className="mt-1 text-sm text-[var(--green)]">הסטטוס הנוכחי שלך</p>
            )}
          </div>
        </button>

        {/* OFF CAMPUS button */}
        <button
          onClick={isOffCampus ? undefined : handleCheckOut}
          disabled={isOffCampus}
          className={cn(
            'relative flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 transition-all active:scale-[0.98]',
            isOffCampus
              ? currentStatus === 'OVERDUE'
                ? 'border-[var(--red)] bg-red-50 dark:bg-red-950/20 cursor-default shadow-lg'
                : 'border-[var(--orange)] bg-orange-50 dark:bg-orange-950/20 cursor-default shadow-lg'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--orange)] hover:bg-orange-50/50 dark:hover:bg-orange-950/10 cursor-pointer shadow-sm hover:shadow-md'
          )}
        >
          <LogOut
            className={cn(
              'h-16 w-16 transition-colors',
              isOffCampus
                ? currentStatus === 'OVERDUE'
                  ? 'text-[var(--red)]'
                  : 'text-[var(--orange)]'
                : 'text-[var(--text-muted)]'
            )}
          />
          <div className="text-center">
            <p
              className={cn(
                'text-3xl font-bold',
                isOffCampus
                  ? currentStatus === 'OVERDUE'
                    ? 'text-[var(--red)]'
                    : 'text-[var(--orange)]'
                  : 'text-[var(--text)]'
              )}
            >
              {currentStatus === 'OVERDUE' ? 'באיחור!' : 'מחוץ לישיבה'}
            </p>
            {isOffCampus && (
              <p
                className={cn(
                  'mt-1 text-sm',
                  currentStatus === 'OVERDUE' ? 'text-[var(--red)]' : 'text-[var(--orange)]'
                )}
              >
                {currentStatus === 'OVERDUE' ? 'עברת את זמן החזרה!' : 'הסטטוס הנוכחי שלך'}
              </p>
            )}
          </div>
        </button>
      </div>

      <OffCampusSheet
        open={showOffCampusSheet}
        onClose={() => setShowOffCampusSheet(false)}
        onSuccess={() => onStatusChange('OFF_CAMPUS')}
      />
    </>
  )
}
