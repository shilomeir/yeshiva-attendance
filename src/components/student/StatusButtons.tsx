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
  onCheckoutSuccess?: (eventId: string) => void
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
        if (!confirmed) return
        await api.cancelAbsenceRequest(activeRequest.id)
      }

      await api.createEvent({
        studentId: currentUser.id,
        type: 'CHECK_IN',
        gpsLat: null,
        gpsLng: null,
        gpsStatus: 'PENDING',
        distanceFromCampus: null,
      })

      onStatusChange('ON_CAMPUS')
      toast({ title: 'ברוך שובך!', description: 'החזרה לישיבה נרשמה בהצלחה' })
    } catch {
      toast({ title: 'שגיאה ברישום החזרה', description: 'נסה שוב', variant: 'destructive' })
    } finally {
      setIsCheckingIn(false)
    }
  }

  const handleCheckOut = () => {
    setShowOffCampusSheet(true)
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-4 px-4 py-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          עדכן סטטוס
        </p>

        {/* ON CAMPUS button */}
        <button
          onClick={isOnCampus ? undefined : handleCheckIn}
          disabled={isOnCampus || isCheckingIn}
          className={cn(
            'group relative flex w-full flex-col items-center gap-4 rounded-2xl border px-6 py-7 transition-all duration-200',
            isOnCampus
              ? 'cursor-default border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
              : 'cursor-pointer border-[var(--border)] bg-[var(--surface)] hover:border-green-300 hover:bg-green-50/60 dark:hover:border-green-800 dark:hover:bg-green-950/10',
            isCheckingIn && 'opacity-70 cursor-not-allowed'
          )}
          style={{
            boxShadow: isOnCampus
              ? '0 4px 20px rgba(34,197,94,0.18), 0 1px 4px rgba(34,197,94,0.1)'
              : '0 1px 6px rgba(14,30,70,0.06)',
          }}
        >
          {/* Icon circle */}
          <div
            className={cn(
              'flex h-20 w-20 items-center justify-center rounded-full transition-all',
              isOnCampus
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-[var(--bg-2)] group-hover:bg-green-100/70'
            )}
          >
            {isCheckingIn ? (
              <Loader2 className="h-10 w-10 animate-spin text-[var(--green)]" />
            ) : (
              <CheckCircle
                className={cn(
                  'h-10 w-10 transition-colors',
                  isOnCampus ? 'text-[var(--green)]' : 'text-[var(--text-muted)] group-hover:text-[var(--green)]'
                )}
              />
            )}
          </div>

          <div className="text-center">
            <p className={cn('text-xl font-bold', isOnCampus ? 'text-green-700 dark:text-green-400' : 'text-[var(--text)]')}>
              בישיבה
            </p>
            {isOnCampus ? (
              <p className="mt-1 text-sm font-medium text-green-600 dark:text-green-500">סטטוס נוכחי ✓</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--text-muted)]">לחץ לרישום חזרה</p>
            )}
          </div>
        </button>

        {/* OFF CAMPUS button */}
        <button
          onClick={isOffCampus ? undefined : handleCheckOut}
          disabled={isOffCampus}
          className={cn(
            'group relative flex w-full flex-col items-center gap-4 rounded-2xl border px-6 py-7 transition-all duration-200',
            isOffCampus
              ? 'cursor-default border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20'
              : 'cursor-pointer border-[var(--border)] bg-[var(--surface)] hover:border-orange-300 hover:bg-orange-50/60 dark:hover:border-orange-800 dark:hover:bg-orange-950/10'
          )}
          style={{
            boxShadow: isOffCampus
              ? '0 4px 20px rgba(249,115,22,0.18), 0 1px 4px rgba(249,115,22,0.1)'
              : '0 1px 6px rgba(14,30,70,0.06)',
          }}
        >
          {/* Icon circle */}
          <div
            className={cn(
              'flex h-20 w-20 items-center justify-center rounded-full transition-all',
              isOffCampus
                ? 'bg-orange-100 dark:bg-orange-900/30'
                : 'bg-[var(--bg-2)] group-hover:bg-orange-100/70'
            )}
          >
            <LogOut
              className={cn(
                'h-10 w-10 transition-colors',
                isOffCampus ? 'text-[var(--orange)]' : 'text-[var(--text-muted)] group-hover:text-[var(--orange)]'
              )}
            />
          </div>

          <div className="text-center">
            <p className={cn('text-xl font-bold', isOffCampus ? 'text-orange-700 dark:text-orange-400' : 'text-[var(--text)]')}>
              מחוץ לישיבה
            </p>
            {isOffCampus ? (
              <p className="mt-1 text-sm font-medium text-orange-600 dark:text-orange-500">סטטוס נוכחי ✓</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--text-muted)]">לחץ לרישום יציאה</p>
            )}
          </div>
        </button>
      </div>

      <OffCampusSheet
        open={showOffCampusSheet}
        onClose={() => setShowOffCampusSheet(false)}
        onSuccess={() => onStatusChange('OFF_CAMPUS')}
        onCheckoutSuccess={(eventId) => onCheckoutSuccess?.(eventId)}
      />
    </>
  )
}
