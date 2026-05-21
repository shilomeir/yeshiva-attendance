import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MapPin,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Navigation,
  HelpCircle,
  Users,
  Download,
  ClipboardList,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { CAMPUS_LAT, CAMPUS_LNG } from '@/lib/location/gps'
import { usePinPrompt } from '@/components/auth/PinPromptDialog'
import { useReloadOnVisibilityAndInterval } from '@/hooks/useReloadOnVisibilityAndInterval'
import { subscribeToAuditSession } from '@/lib/audit/realtimeManager'
import { AuditMissionControl } from '@/components/admin/AuditMissionControl'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Student, ClassStat, AuditSessionWithDetails } from '@/types'

const AUDIT_POLL_FALLBACK_MS = 30_000

// Thresholds
const ON_CAMPUS_METERS = 300
const NEARBY_METERS = 2000

type LocationClass = 'בישיבה' | 'קרוב' | 'רחוק' | 'לא ידוע'

interface StudentWithLocation extends Student {
  locationClass: LocationClass
  distanceMeters: number | null
}

function classifyDistance(dist: number | null): LocationClass {
  if (dist === null) return 'לא ידוע'
  if (dist <= ON_CAMPUS_METERS) return 'בישיבה'
  if (dist <= NEARBY_METERS) return 'קרוב'
  return 'רחוק'
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getDistance(student: Student): number | null {
  if (!student.lastLocation) return null
  return Math.round(haversine(CAMPUS_LAT, CAMPUS_LNG, student.lastLocation.lat, student.lastLocation.lng))
}

const CLASS_CONFIG: Record<LocationClass, { color: string; bg: string; icon: React.ReactNode; order: number }> = {
  'בישיבה': { color: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800', icon: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />, order: 0 },
  'קרוב':   { color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800', icon: <Navigation className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />, order: 1 },
  'רחוק':   { color: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800', icon: <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />, order: 2 },
  'לא ידוע': { color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 border-gray-200 dark:bg-gray-900/20 dark:border-gray-700', icon: <HelpCircle className="h-4 w-4 text-gray-400 dark:text-gray-500" />, order: 3 },
}

function LocationBadge({ cls }: { cls: LocationClass }) {
  const cfg = CLASS_CONFIG[cls]
  const colors: Record<LocationClass, string> = {
    'בישיבה': 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700',
    'קרוב': 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
    'רחוק': 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    'לא ידוע': 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-600',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[cls]}`}>
      {cfg.icon}
      {cls}
    </span>
  )
}

// How long to wait for students to respond (ms)
const LOCATION_RESPONSE_TIMEOUT_MS = 15000

export function RollCallPage() {
  const { requestPin, clearPin } = usePinPrompt()
  const [students, setStudents] = useState<StudentWithLocation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [lastRun, setLastRun] = useState<Date | null>(null)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState<LocationClass | 'הכל'>('הכל')
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pre-audit modal state
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [auditMode, setAuditMode] = useState<'location' | 'manual' | null>(null)
  const [allClassStats, setAllClassStats] = useState<ClassStat[]>([])
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set())
  const [auditTitle, setAuditTitle] = useState('')
  const [isStartingAudit, setIsStartingAudit] = useState(false)

  // Active audit session state
  const [activeSession, setActiveSession] = useState<AuditSessionWithDetails | null>(null)
  const [isClosingSession, setIsClosingSession] = useState(false)

  // Shared refresh — used by the initial mount, the realtime listener, the
  // polling fallback, and the visibilitychange listener. Swallows errors so a
  // transient network blip never blanks the dashboard.
  const refreshActiveSession = useCallback(async () => {
    try {
      const fresh = await api.getActiveAuditSession()
      setActiveSession(fresh)
    } catch {
      /* keep previous state on transient errors */
    }
  }, [])

  useEffect(() => { refreshActiveSession() }, [refreshActiveSession])

  // Belt-and-braces backup for Realtime: poll every 30 s and on tab focus
  // so a missed event after a long iOS suspend or a flaky 3G doesn't leave
  // the admin staring at stale counts.
  useReloadOnVisibilityAndInterval(refreshActiveSession, AUDIT_POLL_FALLBACK_MS)

  // Load class list when modal opens
  useEffect(() => {
    if (!showAuditModal) return
    api.getClassStats()
      .then((stats) => {
        setAllClassStats(stats)
        setSelectedClassIds(new Set(stats.map((s) => s.classId)))
      })
      .catch((err) => {
        toast({ title: 'שגיאה בטעינת כיתות', description: getErrorMessage(err, 'טעינת רשימת הכיתות נכשלה'), variant: 'destructive' })
      })
  }, [showAuditModal])

  const handleOpenModal = () => {
    setAuditMode(null)
    setAuditTitle('')
    setShowAuditModal(true)
  }

  const handleConfirmAudit = async () => {
    if (!auditMode || selectedClassIds.size === 0) return
    const adminPin = await requestPin('admin', 'נדרש PIN מנהל לפתיחת ביקורת פנימית.')
    if (!adminPin) return // user cancelled the PIN prompt

    setIsStartingAudit(true)
    try {
      const result = await api.startAuditSession({
        classIds: [...selectedClassIds],
        title: auditTitle || undefined,
        adminPin,
        mode: auditMode === 'location' ? 'LOCATION' : 'MANUAL',
      })

      if ('error' in result) {
        if (result.error === 'ALREADY_ACTIVE') {
          toast({ title: 'ביקורת פעילה כבר קיימת', description: 'יש לסגור את הביקורת הפעילה לפני פתיחת חדשה', variant: 'destructive' })
          // Load existing session
          const existing = await api.getActiveAuditSession()
          if (existing) setActiveSession(existing)
        } else if (result.error === 'AUTH') {
          // Cached PIN no longer matches DB — drop it and let the user retry
          clearPin('admin')
          toast({ title: 'PIN שגוי', description: 'נסה שוב — תתבקש להזין PIN חדש', variant: 'destructive' })
        } else {
          toast({ title: 'שגיאה בפתיחת ביקורת', description: result.error, variant: 'destructive' })
        }
        return
      }

      setActiveSession(result)
      setShowAuditModal(false)
      toast({ title: 'ביקורת פנימית נפתחה', description: `${result.totalStudentsSnapshot} תלמידים בביקורת` })

      if (auditMode === 'location') {
        // Master plan R-7 / B-19: server-side batched push via the dedicated
        // send-audit-push Edge Function. One HTTP call from the browser; the
        // function verifies the admin PIN, fans out to all students in the
        // snapshot with a concurrency cap of 20, logs per-batch outcomes to
        // audit_push_log, and cleans up gone tokens. Push is advisory (R-5)
        // — failure here does NOT block the audit. Students with the PWA in
        // foreground still see the GPS-share banner via the polling refresh.
        api.sendAuditPush({ sessionId: result.id, adminPin })
          .then((pushResult) => {
            if ('error' in pushResult) {
              if (pushResult.error === 'AUTH') return // cached PIN stale; ignore — admin already inside the session
              toast({ title: 'הביקורת נפתחה — שליחת התראות נכשלה', description: pushResult.error, variant: 'destructive' })
            }
            // success → silent; the audit banner is the primary surface
          })
          .catch(() => { /* network blip; audit still works */ })
        runLocationRollCall()
      } else {
        // Broadcast to supervisors
        const ch = supabase.channel('audit-control')
        await new Promise<void>((resolve) => {
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              ch.send({ type: 'broadcast', event: 'manual_audit_start', payload: { classIds: [...selectedClassIds], sessionId: result.id } })
              resolve()
            }
          })
        })
        supabase.removeChannel(ch)
      }
    } catch (err) {
      toast({ title: 'שגיאה בפתיחת ביקורת', description: getErrorMessage(err, 'פתיחת ביקורת פנימית נכשלה'), variant: 'destructive' })
    } finally {
      setIsStartingAudit(false)
    }
  }

  const handleCloseSession = async () => {
    if (!activeSession) return
    const adminPin = await requestPin('admin', 'נדרש PIN מנהל לסגירת הביקורת.')
    if (!adminPin) return
    setIsClosingSession(true)
    try {
      const result = await api.closeAuditSession(activeSession.id, adminPin)
      if ('error' in result) {
        if (result.error === 'AUTH') {
          clearPin('admin')
          toast({ title: 'PIN שגוי', description: 'נסה שוב', variant: 'destructive' })
        } else if (result.error === 'NOT_ACTIVE') {
          // Session was already closed (race with another admin or tick_audit_timeout)
          setActiveSession(null)
          toast({ title: 'הביקורת כבר סגורה' })
        } else {
          toast({ title: 'שגיאה בסגירת ביקורת', description: result.error, variant: 'destructive' })
        }
      } else {
        setActiveSession(null)
        toast({ title: 'ביקורת נסגרה בהצלחה' })
      }
    } catch (err) {
      toast({ title: 'שגיאה בסגירת ביקורת', description: getErrorMessage(err, 'סגירת ביקורת נכשלה'), variant: 'destructive' })
    } finally {
      setIsClosingSession(false)
    }
  }

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  const enrichAndSet = useCallback((all: Student[]) => {
    const enriched: StudentWithLocation[] = all.map((s) => {
      const dist = getDistance(s)
      return { ...s, distanceMeters: dist, locationClass: classifyDistance(dist) }
    })
    enriched.sort((a, b) => {
      const orderDiff = CLASS_CONFIG[a.locationClass].order - CLASS_CONFIG[b.locationClass].order
      if (orderDiff !== 0) return orderDiff
      return a.fullName.localeCompare(b.fullName, 'he')
    })
    setStudents(enriched)
  }, [])

  const runLocationRollCall = useCallback(async () => {
    setIsLoading(true)
    setIsWaiting(false)
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current)

    try {
      // NOTE: the legacy supabase.channel('location-requests') broadcast was
      // removed. It (a) captured GPS on student devices without an explicit
      // tap, violating consent; (b) only wrote to students.lastLocation, never
      // to audit_entries; (c) wasn't scoped by session/class. Audit-mode GPS
      // now flows entirely through the explicit student "שתף מיקום" banner
      // and submit_student_audit_gps RPC, which writes the audit_entries row
      // with distance/bucket data.
      //
      // The student-list view below remains for the legacy "where is everyone
      // right now" admin glance based on the last GPS each student voluntarily
      // shared. It is *not* the source of truth for the active audit — that
      // lives in the Mission Control panel (which reads audit_entries via
      // realtime + polling).

      const initial = await api.getStudents()
      enrichAndSet(initial)
      setLastRun(new Date())
      setIsLoading(false)

      // Give students ~15s to open the app and share GPS via the banner.
      setIsWaiting(true)
      waitTimerRef.current = setTimeout(async () => {
        try {
          const updated = await api.getStudents()
          enrichAndSet(updated)
          setLastRun(new Date())
        } catch (err) {
          toast({ title: 'שגיאה בעדכון תוצאות ביקורת', description: getErrorMessage(err, 'טעינת מיקומי התלמידים לאחר הביקורת נכשלה'), variant: 'destructive' })
        } finally {
          setIsWaiting(false)
        }
      }, LOCATION_RESPONSE_TIMEOUT_MS)
    } catch (err) {
      toast({ title: 'שגיאה בהפעלת ביקורת', description: getErrorMessage(err, 'שליחת בקשת מיקום לתלמידים נכשלה'), variant: 'destructive' })
      setIsLoading(false)
      setIsWaiting(false)
    }
  }, [enrichAndSet])

  // Listen for realtime updates on the students table
  useEffect(() => {
    const channel = supabase
      .channel('students-location-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students' },
        (payload) => {
          const updated = payload.new as Student
          setStudents((prev) =>
            prev.map((s) => {
              if (s.id !== updated.id) return s
              const dist = getDistance(updated)
              return { ...updated, distanceMeters: dist, locationClass: classifyDistance(dist) }
            })
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Listen for audit session lifecycle changes (start/close/timeout) AND entry changes.
  // submit_audit_entry only mutates audit_entries — not audit_sessions — so
  // without the entries subscription the admin's progress counters stay
  // stale while a supervisor marks students. We refetch the whole active
  // session on any change.
  //
  // Master plan R-35: filters are applied **server-side** via the
  // postgres_changes `filter:` arg so the channel only receives events for
  // the current session id. Without this we'd see every audit_entries row
  // across history. The audit_sessions filter scopes to id; the others to
  // session_id. The channel name is scoped per session to avoid two-admin
  // subscriptions ping-ponging.
  useEffect(() => {
    if (!activeSession?.id) return
    // Master plan R-11: one shared channel per session via the audit
    // realtime manager. The manager applies the R-35 server-side filters
    // and ref-counts subscribers so multiple hooks watching the same
    // session don't open competing channels.
    return subscribeToAuditSession(activeSession.id, refreshActiveSession)
  }, [activeSession?.id, refreshActiveSession])

  useEffect(() => {
    return () => { if (waitTimerRef.current) clearTimeout(waitTimerRef.current) }
  }, [])

  const counts: Record<LocationClass, number> = {
    'בישיבה': students.filter((s) => s.locationClass === 'בישיבה').length,
    'קרוב': students.filter((s) => s.locationClass === 'קרוב').length,
    'רחוק': students.filter((s) => s.locationClass === 'רחוק').length,
    'לא ידוע': students.filter((s) => s.locationClass === 'לא ידוע').length,
  }

  const filtered = students.filter((s) => {
    const matchesClass = filterClass === 'הכל' || s.locationClass === filterClass
    const matchesSearch =
      !search ||
      s.fullName.includes(search) ||
      s.idNumber.includes(search)
    return matchesClass && matchesSearch
  })

  const exportCsv = () => {
    const rows = [
      ['שם', 'ת.ז.', 'טלפון', 'סטטוס נוכחות', 'מיקום', 'מרחק (מטר)', 'זמן עדכון אחרון'],
      ...students.map((s) => [
        s.fullName,
        s.idNumber,
        s.phone,
        s.currentStatus,
        s.locationClass,
        s.distanceMeters ?? '',
        s.lastSeen ? new Date(s.lastSeen).toLocaleString('he-IL') : '',
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ביקורת-${new Date().toLocaleDateString('he-IL').replace(/\//g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">ביקורת פנימית</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {lastRun
              ? `עודכן לאחרונה: ${lastRun.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
              : 'לחץ על "פתח ביקורת" כדי להתחיל'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={isLoading || students.length === 0} size="sm">
            <Download className="h-4 w-4" />
            ייצא CSV
          </Button>
          <Button
            onClick={handleOpenModal}
            disabled={isLoading || isWaiting || !!activeSession}
            size="sm"
          >
            <MapPin className={`h-4 w-4 ${isLoading || isWaiting ? 'animate-spin' : ''}`} />
            {isLoading ? 'שולח בקשה...' : isWaiting ? 'ממתין לתלמידים...' : 'פתח ביקורת'}
          </Button>
        </div>
      </div>

      {/* Active session — Mission Control */}
      {activeSession && (
        <AuditMissionControl
          session={activeSession}
          isClosing={isClosingSession}
          onClose={handleCloseSession}
        />
      )}

      {/* Empty state — only when no active session and no location results */}
      {!activeSession && students.length === 0 && !isLoading && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
          <MapPin className="h-10 w-10 text-[var(--text-muted)] opacity-40" />
          <p className="font-medium text-[var(--text-muted)]">לא בוצעה ביקורת מיקום עדיין</p>
          <p className="text-sm text-[var(--text-muted)]">
            פתח ביקורת עם מיקום כדי לשלוח בקשת GPS לתלמידים
          </p>
        </div>
      )}

      {/* Summary cards (location mode only) */}
      {students.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                { label: 'בישיבה', cls: 'בישיבה' as LocationClass, icon: <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />, bg: 'bg-green-50 dark:bg-green-950/20', num: counts['בישיבה'] },
                { label: 'קרוב לישיבה', cls: 'קרוב' as LocationClass, icon: <Navigation className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />, bg: 'bg-yellow-50 dark:bg-yellow-950/20', num: counts['קרוב'] },
                { label: 'רחוק', cls: 'רחוק' as LocationClass, icon: <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400" />, bg: 'bg-red-50 dark:bg-red-950/20', num: counts['רחוק'] },
                { label: 'לא ידוע', cls: 'לא ידוע' as LocationClass, icon: <HelpCircle className="h-5 w-5 text-gray-400 dark:text-gray-500" />, bg: 'bg-gray-50 dark:bg-gray-900/20', num: counts['לא ידוע'] },
              ] as const
            ).map(({ label, cls, icon, bg, num }) => (
              <button
                key={cls}
                onClick={() => setFilterClass(filterClass === cls ? 'הכל' : cls)}
                className={`rounded-xl border p-4 text-start transition-all hover:shadow-md ${bg} ${filterClass === cls ? 'ring-2 ring-[var(--blue)]' : 'border-[var(--border)]'}`}
              >
                <div className="flex items-center justify-between">
                  {icon}
                  <span className="text-2xl font-bold text-[var(--text)]">{num}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{label}</p>
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[var(--blue)]" />
              <span>מיקום מבוסס על נתוני GPS אחרונים שנשמרו</span>
            </div>
            <span>·</span>
            <span className="text-green-700 dark:text-green-400">בישיבה ≤ {ON_CAMPUS_METERS}מ׳</span>
            <span>·</span>
            <span className="text-yellow-700 dark:text-yellow-400">קרוב ≤ {NEARBY_METERS / 1000}ק״מ</span>
            <span>·</span>
            <span className="text-red-700 dark:text-red-400">רחוק &gt; {NEARBY_METERS / 1000}ק״מ</span>
          </div>

          {/* Search + filter row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Users className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                placeholder="חפש שם או ת.ז..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
              />
            </div>
            {filterClass !== 'הכל' && (
              <Button variant="outline" size="sm" onClick={() => setFilterClass('הכל')}>
                נקה פילטר
              </Button>
            )}
            <span className="text-sm text-[var(--text-muted)] whitespace-nowrap">
              {filtered.length} תלמידים
            </span>
          </div>

          {/* Students list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {filterClass === 'הכל' ? 'כל התלמידים' : filterClass}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="h-6 w-6 animate-spin text-[var(--blue)]" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-[var(--text-muted)]">
                  <MapPin className="h-8 w-8 opacity-30" />
                  <p>לא נמצאו תלמידים</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {filtered.map((student) => {
                    const cfg = CLASS_CONFIG[student.locationClass]
                    return (
                      <div
                        key={student.id}
                        className={`flex items-center gap-3 px-4 py-3 ${cfg.bg} border-s-4 ${
                          student.locationClass === 'בישיבה' ? 'border-s-green-500' :
                          student.locationClass === 'קרוב' ? 'border-s-yellow-500' :
                          student.locationClass === 'רחוק' ? 'border-s-red-500' :
                          'border-s-gray-300'
                        }`}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--blue)] text-xs font-bold text-white">
                          {student.fullName.slice(0, 2)}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium text-[var(--text)]">{student.fullName}</span>
                          <span className="text-xs text-[var(--text-muted)]">ת.ז. {student.idNumber}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <LocationBadge cls={student.locationClass} />
                          {student.distanceMeters !== null && (
                            <span className="text-xs text-[var(--text-muted)]">
                              {student.distanceMeters >= 1000
                                ? `${(student.distanceMeters / 1000).toFixed(1)} ק״מ`
                                : `${student.distanceMeters} מ׳`}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Pre-audit modal */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>פתיחת ביקורת פנימית</DialogTitle>
            <DialogDescription>הגדר את פרטי הביקורת לפני ההפעלה</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5 pt-1">
            {/* Q0: Title */}
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-2">כותרת (אופציונלי)</p>
              <Input
                placeholder='לדוגמה: ביקורת שבתית 17/05'
                value={auditTitle}
                onChange={(e) => setAuditTitle(e.target.value)}
              />
            </div>

            {/* Q1: Mode */}
            <div>
              <p className="text-sm font-semibold text-[var(--text)] mb-2">1. סוג הביקורת</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  data-testid="inspection-mode-card-location"
                  onClick={() => setAuditMode('location')}
                  className={`rounded-lg border p-3 text-sm text-start transition-all ${
                    auditMode === 'location'
                      ? 'border-[var(--blue)] bg-blue-50 dark:bg-blue-950/30 text-[var(--blue)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                  }`}
                >
                  <MapPin className="mb-1 h-4 w-4" />
                  <p className="font-medium">עם מיקום</p>
                  <p className="text-xs opacity-70 mt-0.5">שליחת בקשת GPS לתלמידים</p>
                </button>
                <button
                  data-testid="inspection-mode-card-manual"
                  onClick={() => setAuditMode('manual')}
                  className={`rounded-lg border p-3 text-sm text-start transition-all ${
                    auditMode === 'manual'
                      ? 'border-[var(--blue)] bg-blue-50 dark:bg-blue-950/30 text-[var(--blue)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                  }`}
                >
                  <ClipboardList className="mb-1 h-4 w-4" />
                  <p className="font-medium">ידנית</p>
                  <p className="text-xs opacity-70 mt-0.5">אחראי כיתה מסמן נוכחות</p>
                </button>
              </div>
            </div>

            {/* Q2: Class selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--text)]">2. כיתות משתתפות</p>
                <button
                  className="text-xs text-[var(--blue)] hover:underline"
                  onClick={() =>
                    setSelectedClassIds(
                      selectedClassIds.size === allClassStats.length
                        ? new Set()
                        : new Set(allClassStats.map((s) => s.classId))
                    )
                  }
                >
                  {selectedClassIds.size === allClassStats.length ? 'בטל הכל' : 'בחר הכל'}
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                {allClassStats.length === 0 ? (
                  <p className="p-3 text-sm text-[var(--text-muted)]">טוען כיתות...</p>
                ) : (
                  allClassStats.map((cs) => (
                    <label key={cs.classId} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--bg-2)]">
                      <input
                        type="checkbox"
                        checked={selectedClassIds.has(cs.classId)}
                        onChange={() => toggleClass(cs.classId)}
                        className="accent-[var(--blue)]"
                      />
                      <span className="text-sm text-[var(--text)]">{cs.classId}</span>
                      <span className="text-xs text-[var(--text-muted)] ms-auto">{cs.grade}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAuditModal(false)}>ביטול</Button>
              <Button
                onClick={handleConfirmAudit}
                disabled={!auditMode || selectedClassIds.size === 0 || isStartingAudit}
              >
                {isStartingAudit ? 'פותח ביקורת...' : 'פתח ביקורת'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
