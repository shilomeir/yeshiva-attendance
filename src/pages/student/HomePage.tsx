import { useEffect, useState, useRef, useCallback } from 'react'
import { Clock, Undo2, Calendar, MapPin, CheckCircle2, AlertTriangle } from 'lucide-react'
import { StatusButtons } from '@/components/student/StatusButtons'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import { supabase } from '@/lib/supabase'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Student, CalendarDeparture, AuditSessionWithDetails } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getMinutesFromNow(isoStr: string): number {
  return Math.round((new Date(isoStr).getTime() - Date.now()) / 60000)
}

/* ── Floating status widget (blue gradient card) ── */
function StatusWidget({ student }: { student: Student }) {
  const isOn = student.currentStatus === 'ON_CAMPUS'
  return (
    <div
      className="hero-widget-status"
      style={{
        width: 124, padding: '12px 14px',
        borderRadius: 20,
        transform: 'rotate(-3deg)',
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.85 }}>סטטוס</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.15, marginBottom: 2 }}>
        {isOn ? 'נוכח כעת' : 'בחוץ כרגע'}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.78)', fontWeight: 500 }}>
        {formatRelativeTime(student.lastSeen)}
      </div>
    </div>
  )
}

/* ── Floating history widget (white glass card) ── */
function HistoryWidget({ count }: { count: number }) {
  return (
    <div
      className="hero-widget-history"
      style={{
        width: 116, padding: '12px 14px',
        borderRadius: 20,
        transform: 'rotate(4deg)',
        color: 'var(--text)',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: '#dbeafe',
        display: 'grid', placeItems: 'center', marginBottom: 8,
        color: '#2563eb',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 10h18M8 2v4M16 2v4" />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.15 }}>היסטוריה</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
        {count > 0 ? `${count} יציאות` : 'ציר זמן'}
      </div>
    </div>
  )
}

export function HomePage() {
  const { currentUser, deviceToken } = useAuthStore()
  const [student, setStudent] = useState<Student | null>(currentUser)
  const [undoCheckout, setUndoCheckout] = useState<{ expiresAt: number; departureId: string } | null>(null)
  const [activeDeparture, setActiveDeparture] = useState<CalendarDeparture | null>(null)
  const [recentCount, setRecentCount] = useState(0)
  // LOCATION-mode audit GPS state
  const [activeAuditSession, setActiveAuditSession] = useState<AuditSessionWithDetails | null>(null)
  const [gpsShareState, setGpsShareState] = useState<'idle' | 'capturing' | 'done' | 'error'>('idle')
  const [gpsShareResult, setGpsShareResult] = useState<{ distanceM: number; distanceBucket: string } | null>(null)
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
    const relevant = deps.find((d) => getMinutesFromNow(d.end_at) > -60)
    setActiveDeparture(relevant ?? null)
    setRecentCount(deps.length)
  }, [currentUser?.id])

  useEffect(() => {
    refreshStudent()
    refreshDeparture()
  }, [currentUser?.id])

  useEffect(() => {
    if (!activeDeparture) return
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [activeDeparture])

  useEffect(() => {
    if (!undoCheckout) return
    const remaining = undoCheckout.expiresAt - Date.now()
    if (remaining <= 0) { setUndoCheckout(null); return }
    undoTimerRef.current = setTimeout(() => setUndoCheckout(null), remaining)
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [undoCheckout])

  // Check for an active LOCATION-mode audit that includes this student's class.
  const checkAuditSession = useCallback(async () => {
    if (!currentUser) return
    try {
      const session = await api.getActiveAuditSession()
      if (session && session.mode === 'LOCATION' && session.classIds.includes(currentUser.classId)) {
        setActiveAuditSession(session)
      } else {
        setActiveAuditSession(null)
        if (!session) setGpsShareState('idle') // reset when session ends
      }
    } catch { /* ignore */ }
  }, [currentUser?.id, currentUser?.classId])

  useEffect(() => {
    checkAuditSession()
    const id = setInterval(checkAuditSession, 30_000)
    return () => clearInterval(id)
  }, [checkAuditSession])

  const handleShareGps = useCallback(async () => {
    if (!currentUser || !activeAuditSession || !deviceToken) return
    setGpsShareState('capturing')
    try {
      const pos = await getCurrentPosition()
      if (!isGPSResult(pos)) {
        setGpsShareState('error')
        toast({ title: 'לא ניתן לגשת למיקום', description: 'אפשר גישה למיקום בהגדרות הדפדפן', variant: 'destructive' })
        return
      }
      await api.updateStudentLocation(currentUser.id, pos.lat, pos.lng)
      const result = await api.submitStudentAuditGps({
        sessionId: activeAuditSession.id,
        studentId: currentUser.id,
        deviceToken,
        gpsLat: pos.lat,
        gpsLng: pos.lng,
        accuracyM: pos.accuracy ?? null,
        gpsStatus: 'OK',
      })
      if ('error' in result) {
        setGpsShareState('error')
        toast({ title: 'שגיאה בשיתוף מיקום', description: result.error, variant: 'destructive' })
        return
      }
      setGpsShareState('done')
      setGpsShareResult({ distanceM: result.distanceM, distanceBucket: result.distanceBucket })
    } catch (err) {
      setGpsShareState('error')
      toast({ title: 'שגיאה בשיתוף מיקום', description: getErrorMessage(err, 'שיתוף מיקום נכשל'), variant: 'destructive' })
    }
  }, [currentUser?.id, activeAuditSession?.id, deviceToken])

  useEffect(() => {
    if (!currentUser) return
    const channel = supabase.channel('location-requests')
    channel
      .on('broadcast', { event: 'request_location' }, async () => {
        const result = await getCurrentPosition()
        if (isGPSResult(result)) {
          await api.updateStudentLocation(currentUser.id, result.lat, result.lng)
        }
        // Also check if a LOCATION audit just started
        checkAuditSession()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser?.id, checkAuditSession])

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
    } catch (err) {
      toast({ title: 'שגיאה בביטול', description: getErrorMessage(err, 'ביטול היציאה נכשל'), variant: 'destructive' })
    }
  }

  if (!student) return null

  const undoRemainingMs = undoCheckout ? undoCheckout.expiresAt - Date.now() : 0
  const undoRemainingMin = Math.ceil(undoRemainingMs / 60000)

  return (
    <div className="animate-fade-in" dir="rtl">

      {/* ── Undo checkout banner ── */}
      {undoCheckout && Date.now() < undoCheckout.expiresAt && (
        <div className="animate-slide-up mx-4 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 dark:border-orange-900/50 dark:bg-orange-950/20">
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

      {/* ── LOCATION-mode audit GPS banner ── */}
      {activeAuditSession && (
        <div className="animate-slide-up mx-4 mt-3">
          {gpsShareState === 'done' && gpsShareResult ? (
            <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3.5 dark:border-green-900/50 dark:bg-green-950/20">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">מיקומך נמסר בהצלחה</p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  מרחק מהישיבה:{' '}
                  {gpsShareResult.distanceM < 1000
                    ? `${gpsShareResult.distanceM} מ׳`
                    : `${(gpsShareResult.distanceM / 1000).toFixed(1)} ק״מ`}
                </p>
              </div>
            </div>
          ) : gpsShareState === 'error' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 dark:border-red-900/50 dark:bg-red-950/20">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">לא ניתן לגשת למיקום</p>
                <p className="text-xs text-red-700 dark:text-red-400">בדוק הרשאות מיקום בדפדפן</p>
              </div>
              <button
                onClick={() => { setGpsShareState('idle'); handleShareGps() }}
                className="shrink-0 rounded-xl bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 transition-colors"
              >
                נסה שוב
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/20">
              <div className="flex items-center gap-2.5">
                <MapPin className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">ביקורת פנימית מתבצעת</p>
                  <p className="text-xs text-blue-700 dark:text-blue-400">המנהל מבקש לדעת את מיקומך</p>
                </div>
              </div>
              <button
                onClick={handleShareGps}
                disabled={gpsShareState === 'capturing'}
                className="shrink-0 rounded-xl bg-blue-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {gpsShareState === 'capturing' ? 'מאתר...' : 'שתף מיקום'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Active/approved departure banner ── */}
      {activeDeparture && (() => {
        const minsToStart = getMinutesFromNow(activeDeparture.start_at)
        const minsToEnd = getMinutesFromNow(activeDeparture.end_at)
        if (minsToEnd <= -60) return null
        const isActive = minsToStart <= 0 && minsToEnd > 0
        return (
          <div className="animate-slide-up delay-100 mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/20">
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

      {/* ── Hero section with floating widgets + orb ── */}
      <div className="relative" style={{ minHeight: 480 }}>

        {/* Floating status widget — left, rotated */}
        <div
          className="animate-slide-up"
          style={{
            position: 'absolute', top: 40, left: 12, zIndex: 6,
            animationDelay: '0.15s',
          }}
        >
          <StatusWidget student={student} />
        </div>

        {/* Floating history widget — right, rotated */}
        <div
          className="animate-slide-up"
          style={{
            position: 'absolute', top: 290, right: 12, zIndex: 6,
            animationDelay: '0.25s',
          }}
        >
          <HistoryWidget count={recentCount} />
        </div>

        {/* Status buttons (orb + CTA bar) centered */}
        <div
          className="animate-slide-up"
          style={{
            position: 'relative', zIndex: 10,
            paddingTop: 60,
            animationDelay: '0.05s',
          }}
        >
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

        {/* Calendar hint at bottom */}
        <div
          className="animate-fade-in"
          style={{
            position: 'absolute', bottom: 16, left: 0, right: 0,
            display: 'flex', justifyContent: 'center',
            animationDelay: '0.4s',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 999,
            background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(15,23,42,0.06)',
            backdropFilter: 'blur(8px)',
          }}>
            <Calendar style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              עדכון אחרון: {formatRelativeTime(student.lastSeen)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
