import { useEffect, useState, useRef, useCallback } from 'react'
import { Clock, Undo2 } from 'lucide-react'
import { StatusButtons } from '@/components/student/StatusButtons'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import { supabase } from '@/lib/supabase'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { toast } from '@/hooks/use-toast'
import type { Student, CalendarDeparture } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getMinutesFromNow(isoStr: string): number {
  return Math.round((new Date(isoStr).getTime() - Date.now()) / 60000)
}

export function HomePage() {
  const { currentUser } = useAuthStore()
  const [student, setStudent] = useState<Student | null>(currentUser)
  const [undoCheckout, setUndoCheckout] = useState<{ expiresAt: number; departureId: string } | null>(null)
  const [activeDeparture, setActiveDeparture] = useState<CalendarDeparture | null>(null)
  const [, setTick] = useState(0)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshStudent = useCallback(async () => {
    if (!currentUser) return
    const updated = await api.getStudent(currentUser.id)
    if (updated) setStudent(updated)
  }, [currentUser?.id])

  const refreshDeparture = useCallback(async () => {
    if (!currentUser) return
    const deps = await api.listDepartures({
      studentId: currentUser.id,
      status: ['ACTIVE', 'APPROVED'],
    })
    // Find a departure that hasn't been over for more than 60 minutes
    const relevant = deps.find(
      (d) => getMinutesFromNow(d.end_at) > -60
    )
    setActiveDeparture(relevant ?? null)
  }, [currentUser?.id])

  useEffect(() => {
    refreshStudent()
    refreshDeparture()
  }, [currentUser?.id])

  // Tick every minute to update countdown
  useEffect(() => {
    if (!activeDeparture) return
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [activeDeparture])

  // Undo timeout
  useEffect(() => {
    if (!undoCheckout) return
    const remaining = undoCheckout.expiresAt - Date.now()
    if (remaining <= 0) { setUndoCheckout(null); return }
    undoTimerRef.current = setTimeout(() => setUndoCheckout(null), remaining)
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [undoCheckout])

  // GPS location broadcast listener
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
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id])

  // Realtime updates on departures table
  useDeparturesRealtime({
    onAnyChange: () => {
      refreshStudent()
      refreshDeparture()
    },
  })

  const handleUndoCheckout = async () => {
    if (!currentUser || !undoCheckout) return
    try {
      await api.cancelDeparture(undoCheckout.departureId, currentUser.id, 'STUDENT')
      setStudent((prev) => prev ? { ...prev, currentStatus: 'ON_CAMPUS' } : prev)
      setUndoCheckout(null)
      setActiveDeparture(null)
      toast({ title: 'היציאה בוטלה', description: 'הסטטוס חזר ל"בישיבה"' })
    } catch {
      toast({ title: 'שגיאה בביטול', variant: 'destructive' })
    }
  }

  if (!student) return null

  const undoRemainingMs = undoCheckout ? undoCheckout.expiresAt - Date.now() : 0
  const undoRemainingMin = Math.ceil(undoRemainingMs / 60000)

  return (
    <div className="flex flex-col gap-4 p-4 pt-5 animate-fade-in">
      {/* ── Undo checkout banner ────────────────────────────────────── */}
      {undoCheckout && Date.now() < undoCheckout.expiresAt && (
        <div className="animate-slide-up flex items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 dark:border-orange-900/50 dark:bg-orange-950/20">
          <div className="flex items-center gap-2.5">
            <Undo2 className="h-4 w-4 shrink-0 text-[var(--orange)]" />
            <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
              נרשמה יציאה · נותרו {undoRemainingMin} דק&apos;
            </span>
          </div>
          <button
            onClick={handleUndoCheckout}
            className="shrink-0 rounded-xl bg-orange-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-600 transition-colors"
          >
            בטל
          </button>
        </div>
      )}

      {/* ── Active/approved departure banner ────────────────────────── */}
      {activeDeparture && (() => {
        const minsToStart = getMinutesFromNow(activeDeparture.start_at)
        const minsToEnd = getMinutesFromNow(activeDeparture.end_at)
        if (minsToEnd <= -60) return null
        const isActive = minsToStart <= 0 && minsToEnd > 0
        return (
          <div className="animate-slide-up delay-100 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                יציאה מאושרת: {getTimeStr(activeDeparture.start_at)}–{getTimeStr(activeDeparture.end_at)}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                {isActive
                  ? `נותרו ${minsToEnd} דקות לחזרה`
                  : `היציאה בעוד ${minsToStart} דקות`}
              </p>
            </div>
          </div>
        )
      })()}

      {/* ── Current status card ─────────────────────────────────────── */}
      <div
        className="animate-slide-up delay-200 flex items-center justify-between rounded-2xl px-5 py-4"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            סטטוס נוכחי
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            עדכון אחרון: {formatRelativeTime(student.lastSeen)}
          </p>
        </div>
        <StatusBadge status={student.currentStatus} />
      </div>

      {/* ── Status buttons ──────────────────────────────────────────── */}
      <div className="animate-slide-up delay-300 flex-1">
        <StatusButtons
          currentStatus={student.currentStatus}
          onStatusChange={async (newStatus) => {
            setStudent((prev) => prev ? { ...prev, currentStatus: newStatus } : prev)
            await refreshStudent()
            if (newStatus === 'ON_CAMPUS') {
              setUndoCheckout(null)
              setActiveDeparture(null)
            }
          }}
          onCheckoutSuccess={(departureId) => {
            setUndoCheckout({ expiresAt: Date.now() + 5 * 60 * 1000, departureId })
          }}
        />
      </div>
    </div>
  )
}
