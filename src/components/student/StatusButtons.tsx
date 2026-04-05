import { useState } from 'react'
import { CheckCircle, LogOut, Loader2 } from 'lucide-react'
import { OffCampusSheet } from '@/components/student/OffCampusSheet'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils/cn'
import type { StudentStatus } from '@/types'

interface StatusButtonsProps {
  currentStatus: StudentStatus
  onStatusChange: (newStatus: StudentStatus) => void
  onCheckoutSuccess?: () => void
}

export function StatusButtons({ currentStatus, onStatusChange, onCheckoutSuccess }: StatusButtonsProps) {
  const { currentUser } = useAuthStore()
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [showOffCampusSheet, setShowOffCampusSheet] = useState(false)

  const isOnCampus = currentStatus === 'ON_CAMPUS'
  const isOffCampus = currentStatus === 'OFF_CAMPUS' || currentStatus === 'OVERDUE'

  const handleCheckIn = async () => {
    if (!currentUser || isCheckingIn) return
    setIsCheckingIn(true)

    try {
      // Check for active approved absence requests
      const today = new Date().toISOString().split('T')[0]
      const approvedRequests = await api.getAbsenceRequests({
        studentId: currentUser.id,
        status: 'APPROVED',
      })

      const activeRequest = approvedRequests.find((req) => {
        return req.date <= today && (req.endDate == null || req.endDate >= today)
      })

      if (activeRequest) {
        const confirmed = window.confirm(
          'יש לך בקשת היעדרות מאושרת. האם לבטל אותה ולחזור לישיבה?'
        )
        if (!confirmed) {
          return // User chose not to cancel — abort check-in
        }
        await api.cancelAbsenceRequest(activeRequest.id)
      }

      // GPS is collected ONLY during admin's ביקורת פנימית — not here
      await api.createEvent({
        studentId: currentUser.id,
        type: 'CHECK_IN',
        gpsLat: null,
        gpsLng: null,
        gpsStatus: 'PENDING',
        distanceFromCampus: null,
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
      <div className="flex flex-col items-center justify-center gap-8 p-8 h-full">
        {/* ON CAMPUS circle */}
        <button
          onClick={isOnCampus ? undefined : handleCheckIn}
          disabled={isOnCampus || isCheckingIn}
          className={cn(
            'relative flex h-44 w-44 flex-col items-center justify-center gap-3 rounded-full border-[3px] transition-all active:scale-[0.95] shadow-lg',
            isOnCampus
              ? 'border-[var(--green)] bg-green-50 dark:bg-green-950/20'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--green)] hover:bg-green-50/50 cursor-pointer hover:shadow-xl',
            isCheckingIn && 'opacity-70 cursor-not-allowed'
          )}
        >
          {isCheckingIn ? (
            <Loader2 className="h-14 w-14 text-[var(--green)] animate-spin" />
          ) : (
            <CheckCircle
              className={cn(
                'h-14 w-14 transition-colors',
                isOnCampus ? 'text-[var(--green)]' : 'text-[var(--text-muted)]'
              )}
            />
          )}
          <div className="text-center">
            <p
              className={cn(
                'text-xl font-bold',
                isOnCampus ? 'text-[var(--green)]' : 'text-[var(--text)]'
              )}
            >
              בישיבה
            </p>
            {isOnCampus && (
              <p className="mt-0.5 text-xs text-[var(--green)]">סטטוס נוכחי</p>
            )}
          </div>
        </button>

        {/* OFF CAMPUS circle */}
        <button
          onClick={isOffCampus ? undefined : handleCheckOut}
          disabled={isOffCampus}
          className={cn(
            'relative flex h-44 w-44 flex-col items-center justify-center gap-3 rounded-full border-[3px] transition-all active:scale-[0.95] shadow-lg',
            isOffCampus
              ? currentStatus === 'OVERDUE'
                ? 'border-[var(--red)] bg-red-50 dark:bg-red-950/20'
                : 'border-[var(--orange)] bg-orange-50 dark:bg-orange-950/20'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--orange)] hover:bg-orange-50/50 cursor-pointer hover:shadow-xl'
          )}
        >
          <LogOut
            className={cn(
              'h-14 w-14 transition-colors',
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
                'text-xl font-bold',
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
                  'mt-0.5 text-xs',
                  currentStatus === 'OVERDUE' ? 'text-[var(--red)]' : 'text-[var(--orange)]'
                )}
              >
                {currentStatus === 'OVERDUE' ? 'עברת את זמן החזרה!' : 'סטטוס נוכחי'}
              </p>
            )}
          </div>
        </button>
      </div>

      <OffCampusSheet
        open={showOffCampusSheet}
        onClose={() => setShowOffCampusSheet(false)}
        onSuccess={() => onStatusChange('OFF_CAMPUS')}
        onCheckoutSuccess={onCheckoutSuccess}
      />
    </>
  )
}
