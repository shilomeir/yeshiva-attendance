import { useEffect, useState } from 'react'
import {
  Users, UserCheck, UserX, LogOut, GraduationCap,
  MapPin, Clock, CalendarDays, CheckCircle2, ArrowRightLeft,
  Loader2, AlertOctagon, FileText, ShieldAlert,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { GRADE_LEVELS } from '@/lib/constants/grades'
import { CAMPUS_LAT, CAMPUS_LNG, AREA_RADIUS_METERS } from '@/lib/location/gps'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import type { Student, DashboardStats, ClassStat, AbsenceRequest } from '@/types'

// ── helpers ─────────────────────────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type LocationCategory = 'inYeshiva' | 'inArea' | 'far' | 'unknown'

function getStudentLocation(student: Student): LocationCategory {
  if (student.currentStatus === 'ON_CAMPUS') return 'inYeshiva'
  if (!student.lastLocation) return 'unknown'
  const dist = haversine(CAMPUS_LAT, CAMPUS_LNG, student.lastLocation.lat, student.lastLocation.lng)
  return dist <= AREA_RADIUS_METERS ? 'inArea' : 'far'
}

const LOCATION_LABELS: Record<LocationCategory, { label: string; color: string; dot: string }> = {
  inYeshiva: { label: 'בישיבה',    color: 'text-[var(--green)]',  dot: '#22C55E' },
  inArea:    { label: 'באזור',     color: 'text-[var(--blue)]',   dot: '#3B82F6' },
  far:       { label: 'רחוק',      color: 'text-[var(--red)]',    dot: '#EF4444' },
  unknown:   { label: 'לא ידוע',   color: 'text-[var(--text-muted)]', dot: '#94A3B8' },
}

function getQuotaForGrade(gradeName: string): number {
  const level = GRADE_LEVELS.find((g) => g.name === gradeName)
  if (!level) return 3
  return level.capacity >= 50 ? 6 : 3
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Edit modal ───────────────────────────────────────────────────────────────
interface EditStudentSheetProps {
  student: Student | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function EditStudentSheet({ student, open, onClose, onSuccess }: EditStudentSheetProps) {
  const [mode, setMode] = useState<'checkin' | 'checkout' | 'request' | null>(null)
  // checkout fields
  const [exitType, setExitType] = useState<'today' | 'multiday'>('today')
  const [reason, setReason] = useState('')
  const [returnTime, setReturnTime] = useState('')
  const [returnDate, setReturnDate] = useState('')
  // absence request fields
  const [reqStartDate, setReqStartDate] = useState('')
  const [reqEndDate, setReqEndDate] = useState('')
  const [reqReason, setReqReason] = useState('')
  const [reqStartTime, setReqStartTime] = useState('08:00')
  const [reqEndTime, setReqEndTime] = useState('20:00')
  const [reqIsUrgent, setReqIsUrgent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const todayStr = toDateInput(new Date())
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 2)
  const maxDateStr = toDateInput(maxDate)

  const reset = () => {
    setMode(null)
    setExitType('today')
    setReason('')
    setReturnTime('')
    setReturnDate('')
    setReqStartDate('')
    setReqEndDate('')
    setReqReason('')
    setReqStartTime('08:00')
    setReqEndTime('20:00')
    setReqIsUrgent(false)
  }

  const handleClose = () => { reset(); onClose() }

  const handleCheckIn = async () => {
    if (!student) return
    setIsSubmitting(true)
    try {
      await api.createEvent({ studentId: student.id, type: 'CHECK_IN' })
      toast({ title: `${student.fullName} סומן כנוכח` })
      onSuccess()
      handleClose()
    } catch {
      toast({ title: 'שגיאה בעדכון הסטטוס', variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!student) return
    setIsSubmitting(true)
    try {
      let expectedReturn: string | null = null
      if (exitType === 'today' && returnTime) {
        const d = new Date()
        const [h, m] = returnTime.split(':').map(Number)
        d.setHours(h, m, 0, 0)
        expectedReturn = d.toISOString()
      } else if (exitType === 'multiday' && returnDate) {
        const [y, mo, d] = returnDate.split('-').map(Number)
        const dt = new Date(y, mo - 1, d)
        if (returnTime) { const [h, m] = returnTime.split(':').map(Number); dt.setHours(h, m, 0, 0) }
        else dt.setHours(23, 59, 0, 0)
        expectedReturn = dt.toISOString()
      }
      await api.createEvent({
        studentId: student.id,
        type: 'CHECK_OUT',
        reason: reason || null,
        expectedReturn,
        gpsStatus: 'PENDING',
      })
      toast({ title: `יציאה נרשמה עבור ${student.fullName}` })
      onSuccess()
      handleClose()
    } catch {
      toast({ title: 'שגיאה ברישום היציאה', variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!student || !reqStartDate || !reqReason) return
    setIsSubmitting(true)
    try {
      await api.createAbsenceRequest({
        studentId: student.id,
        date: reqStartDate,
        endDate: reqEndDate || undefined,
        reason: reqReason,
        startTime: reqStartTime,
        endTime: reqEndTime,
        isUrgent: reqIsUrgent,
      })
      toast({ title: `בקשת היעדרות הוגשה עבור ${student.fullName}` })
      onSuccess()
      handleClose()
    } catch {
      toast({ title: 'שגיאה בהגשת הבקשה', variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  if (!student) return null

  const isOutside = student.currentStatus === 'OFF_CAMPUS' || student.currentStatus === 'OVERDUE'

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-[var(--blue)]" />
            ניהול תלמיד
          </SheetTitle>
          <SheetDescription>{student.fullName}</SheetDescription>
        </SheetHeader>

        {/* Current status */}
        <div className="mb-5 flex items-center justify-between rounded-xl bg-[var(--bg-2)] px-4 py-3">
          <span className="text-sm text-[var(--text-muted)]">סטטוס נוכחי</span>
          <StatusBadge status={student.currentStatus} />
        </div>

        {/* Mode selection */}
        {mode === null && (
          <div className="flex flex-col gap-3">
            {isOutside && (
              <button
                onClick={handleCheckIn}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 rounded-xl bg-green-500 py-4 text-base font-semibold text-white shadow-sm hover:bg-green-600 transition-colors disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                סמן כנוכח בישיבה
              </button>
            )}
            <button
              onClick={() => setMode('checkout')}
              className={`flex items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold transition-colors ${
                isOutside
                  ? 'border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-2)] py-3'
                  : 'border-2 border-orange-300 bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-950/20 dark:border-orange-800'
              }`}
            >
              <LogOut className={isOutside ? 'h-4 w-4' : 'h-5 w-5'} />
              {isOutside ? 'עדכן פרטי יציאה' : 'רשום יציאה (עד יומיים)'}
            </button>
            <button
              onClick={() => setMode('request')}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-indigo-300 bg-indigo-50 py-4 text-base font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors dark:bg-indigo-950/20 dark:border-indigo-800"
            >
              <FileText className="h-5 w-5" />
              הגשת בקשת היעדרות
            </button>
          </div>
        )}

        {/* Checkout form */}
        {mode === 'checkout' && (
          <form onSubmit={handleCheckOut} className="flex flex-col gap-4">
            {/* Exit type toggle */}
            <div className="flex rounded-lg border border-[var(--border)] p-1 gap-1">
              {(['today', 'multiday'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setExitType(t)}
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    exitType === t ? 'bg-[var(--blue)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-2)]'
                  }`}
                >
                  {t === 'today' ? 'חזרה היום' : 'יציאה לכמה ימים'}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sv-reason">סיבת היציאה (אופציונלי)</Label>
              <Input
                id="sv-reason"
                placeholder="לדוגמה: ביקור משפחה..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {exitType === 'today' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="sv-time" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />שעת חזרה צפויה (אופציונלי)
                </Label>
                <Input id="sv-time" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className="text-lg" />
              </div>
            )}

            {exitType === 'multiday' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sv-date" className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />תאריך חזרה
                  </Label>
                  <Input id="sv-date" type="date" value={returnDate} min={todayStr} max={maxDateStr} onChange={(e) => setReturnDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sv-time2" className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />שעה (אופציונלי)
                  </Label>
                  <Input id="sv-time2" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">חזור</Button>
              <Button
                type="submit"
                className="flex-1 bg-[var(--orange)] hover:bg-orange-600"
                disabled={isSubmitting || (exitType === 'multiday' && !returnDate)}
              >
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />רושם...</> : 'אישור יציאה'}
              </Button>
            </div>
          </form>
        )}

        {/* Absence request form */}
        {mode === 'request' && (
          <form onSubmit={handleRequest} className="flex flex-col gap-4">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 dark:border-indigo-800/40 dark:bg-indigo-950/10">
              <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                בקשה תוגש לאישור המנהל ותסומן כ"ממתין לאישור"
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-start" className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />תאריך יציאה
                </Label>
                <Input id="req-start" type="date" value={reqStartDate} min={todayStr} onChange={(e) => setReqStartDate(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-end" className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />תאריך חזרה (אופציונלי)
                </Label>
                <Input id="req-end" type="date" value={reqEndDate} min={reqStartDate || todayStr} onChange={(e) => setReqEndDate(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-stime" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />שעת יציאה
                </Label>
                <Input id="req-stime" type="time" value={reqStartTime} onChange={(e) => setReqStartTime(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-etime" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />שעת חזרה
                </Label>
                <Input id="req-etime" type="time" value={reqEndTime} onChange={(e) => setReqEndTime(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="req-reason">סיבה</Label>
              <Input
                id="req-reason"
                placeholder="לדוגמה: שמחת משפחה..."
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                required
              />
            </div>

            {/* Urgent toggle */}
            <button
              type="button"
              onClick={() => setReqIsUrgent(v => !v)}
              className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors text-right ${
                reqIsUrgent
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg-2)]'
              }`}
            >
              <ShieldAlert className={`h-5 w-5 shrink-0 ${reqIsUrgent ? 'text-indigo-600' : 'text-[var(--text-muted)]'}`} />
              <div className="flex flex-col items-start">
                <span className={`text-sm font-semibold ${reqIsUrgent ? 'text-indigo-700 dark:text-indigo-300' : 'text-[var(--text)]'}`}>
                  מצב חריג
                </span>
                <span className="text-xs text-[var(--text-muted)]">לא נספר במכסה הרגילה</span>
              </div>
              <div className={`mr-auto h-5 w-5 rounded-full border-2 transition-colors ${reqIsUrgent ? 'border-indigo-500 bg-indigo-500' : 'border-[var(--border)]'}`}>
                {reqIsUrgent && <CheckCircle2 className="h-full w-full text-white p-0.5" />}
              </div>
            </button>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">חזור</Button>
              <Button
                type="submit"
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={isSubmitting || !reqStartDate || !reqReason}
              >
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />שולח...</> : 'הגש בקשה'}
              </Button>
            </div>
          </form>
        )}

        {mode === null && (
          <Button type="button" variant="ghost" onClick={handleClose} className="mt-4 w-full text-[var(--text-muted)]">
            ביטול
          </Button>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Avatar helper ────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const p = name.trim().split(' ')
  return p.length >= 2 ? `${p[0][0]}${p[p.length - 1][0]}` : name.substring(0, 2)
}
function getAvatarColor(id: string): string {
  const cols = ['bg-blue-500','bg-purple-500','bg-green-500','bg-orange-500','bg-red-500','bg-indigo-500','bg-teal-500','bg-pink-500']
  let h = 0; for (let i = 0; i < id.length; i++) { h = (h << 5) - h + id.charCodeAt(i); h |= 0 }
  return cols[Math.abs(h) % cols.length]
}

// ── Main dashboard ───────────────────────────────────────────────────────────
function getTodayStr() { return new Date().toISOString().slice(0, 10) }
function parseTimeToday(t: string): Date {
  const [h, m] = t.split(':').map(Number)
  const d = new Date(); d.setHours(h, m, 0, 0); return d
}
function minsRemaining(endTime: string) {
  return Math.round((parseTimeToday(endTime).getTime() - Date.now()) / 60000)
}

export function ClassSupervisorDashboard() {
  const { classSupervisor, logout } = useAuthStore()
  const [globalStats, setGlobalStats] = useState<DashboardStats | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [todayDepartures, setTodayDepartures] = useState<AbsenceRequest[]>([])
  const [, setTick] = useState(0)
  const [manualAuditActive, setManualAuditActive] = useState(false)
  const [auditPresence, setAuditPresence] = useState<Map<string, boolean>>(new Map())

  // Derive safely before hooks — avoids conditional-return-before-useEffect violation
  const classId = classSupervisor?.classId ?? ''
  const gradeName = classSupervisor?.gradeName ?? ''

  const loadData = async () => {
    if (!classId) return
    try {
      const [gs, sts, cs] = await Promise.all([
        api.getDashboardStats(),
        api.getStudents({ classId }),
        api.getClassStats(),
      ])
      setGlobalStats(gs)
      setStudents(sts as Student[])
      setClassStats(cs)
    } catch {
      console.error('Failed to load supervisor data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!classId) return
    loadData()
    const ch = supabase
      .channel('supervisor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  // Load today's departures for this class
  useEffect(() => {
    if (!classId) return
    const today = getTodayStr()
    api.getAbsenceRequests({ status: 'APPROVED' }).then((reqs) => {
      setTodayDepartures(
        reqs.filter((r) => r.date === today && minsRemaining(r.endTime) > -60)
      )
    })
    const tick = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(tick)
  }, [classId])

  // Subscribe to manual audit broadcasts from admin
  useEffect(() => {
    if (!classId) return
    const ch = supabase
      .channel('audit-control')
      .on('broadcast', { event: 'manual_audit_start' }, ({ payload }) => {
        const { classIds } = payload as { classIds: string[] }
        if (classIds.includes(classId)) {
          setManualAuditActive(true)
          setAuditPresence(new Map())
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  if (!classSupervisor) return null

  const quota = getQuotaForGrade(gradeName)
  const classLabel = classId.includes(' כיתה ') ? `כיתה ${classId.split(' כיתה ')[1]}` : classId

  // Class stats
  const classOnCampus = students.filter(s => s.currentStatus === 'ON_CAMPUS').length
  const classOffCampus = students.filter(s => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length
  const classTotal = students.length
  const classPct = classTotal > 0 ? Math.round((classOnCampus / classTotal) * 100) : 0

  // Check if any student has GPS data (audit mode)
  const hasLocationData = students.some(s => s.lastLocation !== null)

  // Location breakdown for this class
  const locationCounts = students.reduce((acc, s) => {
    const cat = getStudentLocation(s)
    acc[cat] = (acc[cat] ?? 0) + 1
    return acc
  }, {} as Record<LocationCategory, number>)

  // Grade-level class stats (excluding own class)
  const gradeLevelClasses = classStats
    .filter(cs => cs.grade === gradeName)
    .sort((a, b) => a.classId.localeCompare(b.classId, 'he'))

  // Yeshiva-wide %
  const globalPct = globalStats && globalStats.total > 0
    ? Math.round((globalStats.onCampus / globalStats.total) * 100)
    : 0
  const heroColor =
    globalPct >= 80 ? { text: 'text-[var(--green)]', bar: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-200 dark:border-green-800/40' }
    : globalPct >= 60 ? { text: 'text-[var(--orange)]', bar: 'bg-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border-orange-200 dark:border-orange-800/40' }
    : { text: 'text-[var(--red)]', bar: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-200 dark:border-red-800/40' }

  const classColor =
    classPct >= 80 ? { bar: 'bg-green-500', text: 'text-[var(--green)]', ring: 'ring-green-200 dark:ring-green-800' }
    : classPct >= 60 ? { bar: 'bg-orange-400', text: 'text-[var(--orange)]', ring: 'ring-orange-200 dark:ring-orange-800' }
    : { bar: 'bg-red-500', text: 'text-[var(--red)]', ring: 'ring-red-200 dark:ring-red-800' }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--blue)]/10">
            <GraduationCap className="h-5 w-5 text-[var(--blue)]" />
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--text)]">{gradeName}</p>
            <p className="text-xs text-[var(--text-muted)]">{classLabel} — אחראי כיתה</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-[var(--text-muted)]">
          <LogOut className="h-4 w-4" />
          יציאה
        </Button>
      </header>

      <div className="flex flex-col gap-5 p-4 lg:p-6">
        {/* Manual audit banner */}
        {manualAuditActive && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="font-semibold text-amber-700 dark:text-amber-300">ביקורת פנימית פעילה — סמן נוכחות</p>
            </div>
            <div className="flex flex-col gap-1.5 mb-3">
              {students.map((s) => {
                const present = auditPresence.get(s.id)
                return (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-white dark:bg-amber-900/20 px-3 py-2">
                    <span className="text-sm font-medium text-[var(--text)]">{s.fullName}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAuditPresence((prev) => new Map(prev).set(s.id, true))}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${present === true ? 'bg-green-500 text-white' : 'border border-green-300 text-green-700 hover:bg-green-50'}`}
                      >נוכח</button>
                      <button
                        onClick={() => setAuditPresence((prev) => new Map(prev).set(s.id, false))}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${present === false ? 'bg-red-500 text-white' : 'border border-red-300 text-red-700 hover:bg-red-50'}`}
                      >נעדר</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => setManualAuditActive(false)}
              className="w-full rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              סיום ביקורת
            </button>
          </div>
        )}

        {/* Global % hero */}
        <Card className={`border ${heroColor.border} ${heroColor.bg}`}>
          <CardContent className="p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">נוכחות כלל הישיבה</p>
            <div className="flex items-end gap-3">
              <span className={`text-5xl font-extrabold leading-none ${heroColor.text}`}>
                {isLoading ? '—' : `${globalPct}%`}
              </span>
              {globalStats && (
                <span className="mb-1 text-sm text-[var(--text-muted)]">
                  {globalStats.onCampus} / {globalStats.total} תלמידים בישיבה
                </span>
              )}
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div className={`h-full rounded-full transition-all duration-700 ${heroColor.bar}`} style={{ width: `${isLoading ? 0 : globalPct}%` }} />
            </div>
          </CardContent>
        </Card>

        {/* Class stats card */}
        <Card className={`ring-1 ${classColor.ring} bg-[var(--surface)]`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--blue)]/10">
                  <Users className="h-4 w-4 text-[var(--blue)]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">{classLabel}</p>
                  <p className="text-xs text-[var(--text-muted)]">{gradeName}</p>
                </div>
              </div>
              <span className={`text-3xl font-extrabold ${classColor.text}`}>
                {isLoading ? '—' : `${classPct}%`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div className={`h-full rounded-full transition-all duration-700 ${classColor.bar}`} style={{ width: `${isLoading ? 0 : classPct}%` }} />
            </div>
            <div className="mt-3 flex gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[var(--text-muted)]">בישיבה: <strong className="text-[var(--text)]">{classOnCampus}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-orange-400" />
                <span className="text-[var(--text-muted)]">בחוץ: <strong className="text-[var(--text)]">{classOffCampus}</strong></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--border)]" />
                <span className="text-[var(--text-muted)]">מכסה: <strong className={classOffCampus >= quota ? 'text-[var(--red)]' : 'text-[var(--text)]'}>{classOffCampus}/{quota}</strong></span>
              </div>
            </div>

            {/* Location breakdown — shown only when audit GPS data exists */}
            {hasLocationData && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                <p className="w-full text-xs font-medium text-[var(--text-muted)] mb-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> מיקום (ביקורת)
                </p>
                {(['inYeshiva', 'inArea', 'far'] as LocationCategory[]).map(cat => {
                  const count = locationCounts[cat] ?? 0
                  if (count === 0) return null
                  const cfg = LOCATION_LABELS[cat]
                  return (
                    <div key={cat} className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cfg.dot }} />
                      <span className="text-[var(--text-muted)]">{cfg.label}</span>
                      <span className={`font-bold ${cfg.color}`}>{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grade-level spots */}
        {gradeLevelClasses.length > 1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertOctagon className="h-4 w-4 text-[var(--blue)]" />
                מצב השכבה — {gradeName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {gradeLevelClasses.map(cs => {
                  const isSelf = cs.classId === classId
                  const cQuota = getQuotaForGrade(cs.grade)
                  const spotsUsed = cs.offCampus
                  const spotsLeft = Math.max(0, cQuota - spotsUsed)
                  const isFull = spotsLeft === 0
                  const cLabel = cs.classId.includes(' כיתה ') ? `כיתה ${cs.classId.split(' כיתה ')[1]}` : cs.classId
                  const cPct = cs.total > 0 ? Math.round((cs.onCampus / cs.total) * 100) : 0

                  return (
                    <div
                      key={cs.classId}
                      className={`relative rounded-xl border p-3 transition-all ${
                        isSelf
                          ? 'border-[var(--blue)] bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-[var(--blue)]/30'
                          : isFull
                          ? 'border-red-200 bg-red-50/40 dark:border-red-800 dark:bg-red-950/10'
                          : 'border-[var(--border)] bg-[var(--surface)]'
                      }`}
                    >
                      {isSelf && (
                        <span className="absolute -top-2 right-2 rounded-full bg-[var(--blue)] px-1.5 py-0.5 text-[9px] font-bold text-white">הכיתה שלי</span>
                      )}
                      <p className="text-sm font-bold text-[var(--text)]">{cLabel}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">{cPct}% נוכחים</span>
                        <span className={`text-xs font-semibold ${isFull ? 'text-[var(--red)]' : spotsLeft <= 1 ? 'text-[var(--orange)]' : 'text-[var(--green)]'}`}>
                          {isFull ? 'מלאה' : `${spotsLeft} מקומות`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                        <div
                          className={`h-full rounded-full ${isFull ? 'bg-red-500' : cPct >= 80 ? 'bg-green-500' : 'bg-orange-400'}`}
                          style={{ width: `${cPct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--text-muted)]">{cs.onCampus}/{cs.total} בישיבה · {spotsUsed}/{cQuota} מכסה</p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Student list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[var(--blue)]" />
                תלמידי {classLabel}
              </span>
              <span className="text-sm font-normal text-[var(--text-muted)]">
                {classOnCampus}/{classTotal} נוכחים
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : students.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--text-muted)]">אין תלמידים בכיתה זו</p>
            ) : (
              <ul>
                {students
                  .sort((a, b) => {
                    // Sort: outside first, then by name
                    const aOut = a.currentStatus !== 'ON_CAMPUS' ? 0 : 1
                    const bOut = b.currentStatus !== 'ON_CAMPUS' ? 0 : 1
                    if (aOut !== bOut) return aOut - bOut
                    return a.fullName.localeCompare(b.fullName, 'he')
                  })
                  .map(student => {
                    const isOut = student.currentStatus === 'OFF_CAMPUS' || student.currentStatus === 'OVERDUE'
                    const locCat = getStudentLocation(student)
                    const locCfg = LOCATION_LABELS[locCat]
                    const showLoc = hasLocationData && isOut && student.lastLocation

                    return (
                      <li
                        key={student.id}
                        className={`flex items-center gap-3 border-b border-[var(--border)] px-4 last:border-b-0 transition-colors hover:bg-[var(--bg-2)] ${
                          isOut ? 'bg-orange-50/30 dark:bg-orange-950/10' : ''
                        }`}
                        style={{ minHeight: '68px' }}
                      >
                        {/* Avatar */}
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${getAvatarColor(student.id)}`}>
                          {getInitials(student.fullName)}
                        </div>

                        {/* Info */}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate font-medium text-[var(--text)]">{student.fullName}</span>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={student.currentStatus} />
                            {showLoc && (
                              <span className={`flex items-center gap-1 text-xs font-medium ${locCfg.color}`}>
                                <MapPin className="h-3 w-3" />
                                {locCfg.label}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Edit */}
                        <button
                          onClick={() => setEditStudent(student)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--blue)]"
                          title="ניהול תלמיד"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </button>
                      </li>
                    )
                  })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Today's departures */}
      {todayDepartures.length > 0 && (() => {
        const classStudentIds = new Set(students.map(s => s.id))
        const classDeps = todayDepartures.filter(d => classStudentIds.has(d.studentId))
        if (classDeps.length === 0) return null
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-[var(--blue)]" />
                יציאות היום ({classDeps.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {classDeps.map((dep) => {
                  const s = students.find(st => st.id === dep.studentId)
                  const mins = minsRemaining(dep.endTime)
                  const isActive = minsRemaining(dep.startTime) <= 0 && mins > 0
                  const isPending = minsRemaining(dep.startTime) > 0
                  return (
                    <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="font-medium text-sm text-[var(--text)] flex-1">{s?.fullName ?? '—'}</span>
                      <span className="text-xs text-[var(--text-muted)] shrink-0">{dep.startTime}–{dep.endTime}</span>
                      <span className={`text-xs font-medium shrink-0 ${isActive ? 'text-orange-500' : isPending ? 'text-blue-500' : 'text-[var(--text-muted)]'}`}>
                        {isActive ? `נותרו ${mins} דק'` : isPending ? `בעוד ${minsRemaining(dep.startTime)} דק'` : 'הסתיים'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Edit sheet */}
      <EditStudentSheet
        student={editStudent}
        open={editStudent !== null}
        onClose={() => setEditStudent(null)}
        onSuccess={loadData}
      />
    </div>
  )
}
