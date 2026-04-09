import { useEffect, useState, useRef } from 'react'
import { Clock } from 'lucide-react'
import { StatusButtons } from '@/components/student/StatusButtons'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'
import type { Student, AbsenceRequest } from '@/types'

function getTodayStr() {
  return new Date().toISOString().slice(0, 10)
}

function parseTimeToday(timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

function getMinutesRemaining(endTime: string): number {
  return Math.round((parseTimeToday(endTime).getTime() - Date.now()) / 60000)
}

export function HomePage() {
  const { currentUser } = useAuthStore()
  const [student, setStudent] = useState<Student | null>(currentUser)
  const [undoCheckout, setUndoCheckout] = useState<{ expiresAt: number } | null>(null)
  const [todayDeparture, setTodayDeparture] = useState<AbsenceRequest | null>(null)
  const [, setTick] = useState(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshStudent = async () => {
    if (!currentUser) return
    const updated = await api.getStudent(currentUser.id)
    if (updated) setStudent(updated)
  }

  useEffect(() => {
    refreshStudent()
  }, [currentUser?.id])

  // Load today's approved departure request
  useEffect(() => {
    if (!currentUser) return
    api.getAbsenceRequests({ studentId: currentUser.id, status: 'APPROVED' }).then((reqs) => {
      const today = getTodayStr()
      const active = reqs.find(
        (r) => r.date === today && getMinutesRemaining(r.endTime) > -60
      )
      setTodayDeparture(active ?? null)
    })
  }, [currentUser?.id])

  // Tick every minute to keep countdown live
  useEffect(() => {
    if (!todayDeparture) return
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [todayDeparture])

  // Clear undo buffer when it expires
  useEffect(() => {
    if (!undoCheckout) return
    const remaining = undoCheckout.expiresAt - Date.now()
    if (remaining <= 0) {
      setUndoCheckout(null)
      return
    }
    undoTimerRef.current = setTimeout(() => {
      setUndoCheckout(null)
    }, remaining)
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [undoCheckout])

  // Listen for admin location-audit broadcasts and respond with current GPS
  useEffect(() => {
    if (!currentUser) return

    const channel = supabase.channel('location-requests')

    channel
      .on('broadcast', { event: 'request_location' }, async () => {
        const result = await getCurrentPosition()
        if (isGPSResult(result)) {
          await api.updateStudentLocation(currentUser.id, result.lat, result.lng)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser?.id])

  const handleUndoCheckout = async () => {
    if (!currentUser) return
    try {
      await api.createEvent({
        studentId: currentUser.id,
        type: 'CHECK_IN',
        gpsLat: null,
        gpsLng: null,
        gpsStatus: 'PENDING',
        distanceFromCampus: null,
      })
      setStudent((prev) => prev ? { ...prev, currentStatus: 'ON_CAMPUS' } : prev)
      setUndoCheckout(null)
      toast({ title: 'היציאה בוטלה', description: 'הסטטוס חזר ל"בישיבה"' })
    } catch {
      toast({ title: 'שגיאה בביטול', variant: 'destructive' })
    }
  }

  if (!student) return null

  const undoRemainingMs = undoCheckout ? undoCheckout.expiresAt - Date.now() : 0
  const undoRemainingMin = Math.ceil(undoRemainingMs / 60000)

  return (
    <div className="flex flex-col gap-4 p-4 pt-6">
      {/* Undo checkout banner */}
      {undoCheckout && Date.now() < undoCheckout.expiresAt && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-orange-100 px-4 py-3 text-sm dark:bg-orange-950/30">
          <span className="text-orange-700 dark:text-orange-400">
            נרשמה יציאה. טעית? ({undoRemainingMin} דק&apos;)
          </span>
          <button
            onClick={handleUndoCheckout}
            className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
          >
            בטל פעולה
          </button>
        </div>
      )}

      {/* Departure countdown banner */}
      {todayDeparture && (() => {
        const minsToStart = getMinutesRemaining(todayDeparture.startTime)
        const minsToEnd = getMinutesRemaining(todayDeparture.endTime)
        if (minsToEnd <= -60) return null
        const isActive = minsToStart <= 0 && minsToEnd > 0
        return (
          <div className="flex items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 dark:bg-blue-950/30">
            <Clock className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                יציאה מאושרת: {todayDeparture.startTime}–{todayDeparture.endTime}
              </span>
              <span className="mx-1 text-blue-500">·</span>
              {isActive ? (
                <span className="text-blue-600 dark:text-blue-400">
                  נותרו {minsToEnd} דק&apos; לחזרה
                </span>
              ) : (
                <span className="text-blue-600 dark:text-blue-400">
                  היציאה בעוד {minsToStart} דק&apos;
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* Current status card */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-[var(--text-muted)]">סטטוס נוכחי</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              עדכון אחרון: {formatRelativeTime(student.lastSeen)}
            </p>
          </div>
          <StatusBadge status={student.currentStatus} />
        </CardContent>
      </Card>

      {/* Status buttons */}
      <div className="flex-1">
        <StatusButtons
          currentStatus={student.currentStatus}
          onStatusChange={async (newStatus) => {
            const wasOnCampus = student?.currentStatus === 'ON_CAMPUS'
            setStudent((prev) => prev ? { ...prev, currentStatus: newStatus } : prev)
            await refreshStudent()
            if (newStatus === 'OFF_CAMPUS' && wasOnCampus) {
              setUndoCheckout({ expiresAt: Date.now() + 5 * 60 * 1000 })
            } else if (newStatus === 'ON_CAMPUS') {
              setUndoCheckout(null)
            }
          }}
          onCheckoutSuccess={() => {
            setUndoCheckout({ expiresAt: Date.now() + 5 * 60 * 1000 })
          }}
        />
      </div>
    </div>
  )
}
