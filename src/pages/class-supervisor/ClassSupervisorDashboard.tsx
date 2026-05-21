import { useEffect, useRef, useState } from 'react'
import {
  Users, LogOut, GraduationCap, MapPin, Clock, CalendarDays,
  CheckCircle2, ArrowRightLeft, Loader2, AlertOctagon, FileText,
  ShieldAlert, X,
} from 'lucide-react'
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
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { calcQuota } from '@/lib/quota'
import { CAMPUS_LAT, CAMPUS_LNG, AREA_RADIUS_METERS } from '@/lib/location/gps'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getResultErrorMessage } from '@/lib/errors'
import type { Student, ClassStat, CalendarDeparture } from '@/types'

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

const LOCATION_CFG: Record<LocationCategory, { label: string; color: string }> = {
  inYeshiva: { label: 'בישיבה',  color: 'var(--good)' },
  inArea:    { label: 'באזור',   color: 'var(--info)' },
  far:       { label: 'רחוק',    color: 'var(--bad)'  },
  unknown:   { label: 'לא ידוע', color: 'var(--ink-faint)' },
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function minsFromNow(isoStr: string): number {
  return Math.round((new Date(isoStr).getTime() - Date.now()) / 60000)
}

// ── Edit modal ────────────────────────────────────────────────────────────────
interface EditStudentSheetProps {
  student: Student | null
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function EditStudentSheet({ student, open, onClose, onSuccess }: EditStudentSheetProps) {
  const [mode, setMode] = useState<'checkin' | 'checkout' | 'request' | null>(null)
  const [exitType, setExitType] = useState<'today' | 'multiday'>('today')
  const [reason, setReason] = useState('')
  const [returnTime, setReturnTime] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [reqStartDate, setReqStartDate] = useState('')
  const [reqEndDate, setReqEndDate] = useState('')
  const [reqReason, setReqReason] = useState('')
  const [reqStartTime, setReqStartTime] = useState('08:00')
  const [reqEndTime, setReqEndTime] = useState('20:00')
  const [reqIsUrgent, setReqIsUrgent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const todayStr = toDateInput(new Date())
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 30)
  const maxDateStr = toDateInput(maxDate)

  const reset = () => {
    setMode(null); setExitType('today'); setReason(''); setReturnTime(''); setReturnDate('')
    setReqStartDate(''); setReqEndDate(''); setReqReason(''); setReqStartTime('08:00')
    setReqEndTime('20:00'); setReqIsUrgent(false)
  }
  const handleClose = () => { reset(); onClose() }

  const handleCheckIn = async () => {
    if (!student) return
    setIsSubmitting(true)
    try {
      const activeDeps = await api.listDepartures({ studentId: student.id, status: 'ACTIVE' })
      if (activeDeps.length > 0) {
        await api.returnDeparture(activeDeps[0].id, student.id)
      } else {
        await api.createAdminOverride(student.id, 'ON_CAMPUS', 'עדכון ידני על ידי אחראי כיתה')
      }
      toast({ title: `${student.fullName} סומן כנוכח` })
      onSuccess(); handleClose()
    } catch (err) {
      toast({ title: 'שגיאה בעדכון הסטטוס', description: getErrorMessage(err, 'עדכון סטטוס התלמיד נכשל'), variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!student) return
    setIsSubmitting(true)
    try {
      const now = new Date()
      let endAt: Date
      if (exitType === 'today' && returnTime) {
        const [h, m] = returnTime.split(':').map(Number)
        endAt = new Date(); endAt.setHours(h, m, 0, 0)
      } else if (exitType === 'multiday' && returnDate) {
        const [y, mo, d] = returnDate.split('-').map(Number)
        endAt = new Date(y, mo - 1, d)
        if (returnTime) { const [h, m] = returnTime.split(':').map(Number); endAt.setHours(h, m, 0, 0) }
        else endAt.setHours(23, 59, 0, 0)
      } else {
        endAt = new Date(now.getTime() + 4 * 3600_000)
      }
      const result = await api.submitDeparture({
        studentId: student.id, startAt: now, endAt,
        reason: reason || null, source: 'SUPERVISOR', actorRole: 'SUPERVISOR',
      })
      if ('error' in result) {
        toast({ title: 'שגיאה', description: getResultErrorMessage(result, 'רישום היציאה נכשל'), variant: 'destructive' })
      } else if (result.status === 'QUOTA_FULL') {
        toast({ title: 'המכסה מלאה', description: 'לא ניתן לרשום יציאה — המכסה מלאה', variant: 'destructive' })
      } else {
        toast({ title: `יציאה נרשמה עבור ${student.fullName}` })
        onSuccess(); handleClose()
      }
    } catch (err) {
      toast({ title: 'שגיאה ברישום היציאה', description: getErrorMessage(err, 'רישום היציאה נכשל'), variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!student || !reqStartDate || !reqReason) return
    setIsSubmitting(true)
    try {
      const startAt = new Date(`${reqStartDate}T${reqStartTime}:00`)
      const endAt   = new Date(`${reqEndDate || reqStartDate}T${reqEndTime}:00`)
      const result  = await api.submitDeparture({
        studentId: student.id, startAt, endAt, reason: reqReason,
        isUrgent: reqIsUrgent, source: 'SUPERVISOR', forcePending: true, actorRole: 'SUPERVISOR',
      })
      if ('error' in result) {
        toast({ title: 'שגיאה', description: getResultErrorMessage(result, 'רישום ההיעדרות נכשל'), variant: 'destructive' })
        return
      }
      if (result.status === 'QUOTA_FULL') {
        toast({ title: 'שגיאה בלתי צפויה', description: getResultErrorMessage(result, 'המכסה מלאה'), variant: 'destructive' })
        return
      }
      await api.approveDeparture(result.id, 'supervisor', 'SUPERVISOR', 'אושר על ידי אחראי כיתה')
      toast({ title: `היעדרות אושרה עבור ${student.fullName}` })
      onSuccess(); handleClose()
    } catch (err) {
      toast({ title: 'שגיאה ברישום ההיעדרות', description: getErrorMessage(err, 'רישום ההיעדרות נכשל'), variant: 'destructive' })
    } finally { setIsSubmitting(false) }
  }

  if (!student) return null
  const isOutside = student.currentStatus === 'OFF_CAMPUS' || student.currentStatus === 'OVERDUE'

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[90vh] overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" style={{ color: 'var(--accent)' }} />
            ניהול תלמיד
          </SheetTitle>
          <SheetDescription>{student.fullName}</SheetDescription>
        </SheetHeader>

        <div className="mb-5 flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--glass-2)', border: '1px solid var(--hairline)' }}>
          <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>סטטוס נוכחי</span>
          <StatusBadge status={student.currentStatus} />
        </div>

        {mode === null && (
          <div className="flex flex-col gap-3">
            {isOutside && (
              <button
                onClick={handleCheckIn}
                disabled={isSubmitting}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  borderRadius: 14, padding: '14px', border: 'none',
                  background: 'linear-gradient(135deg, var(--good), #16a34a)',
                  color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  opacity: isSubmitting ? 0.6 : 1, fontFamily: 'inherit',
                }}
              >
                {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                סמן כנוכח בישיבה
              </button>
            )}
            <button
              onClick={() => setMode('checkout')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                borderRadius: 14, padding: isOutside ? '10px 14px' : '14px',
                border: `1.5px solid ${isOutside ? 'var(--hairline)' : 'var(--warn)'}`,
                background: isOutside ? 'rgba(255,255,255,0.6)' : 'var(--warn-soft)',
                color: isOutside ? 'var(--ink-muted)' : 'var(--warn)',
                fontSize: isOutside ? 13 : 15, fontWeight: isOutside ? 500 : 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <LogOut className={isOutside ? 'h-4 w-4' : 'h-5 w-5'} />
              {isOutside ? 'עדכן פרטי יציאה' : 'רשום יציאה (עד יומיים)'}
            </button>
            <button
              onClick={() => setMode('request')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                borderRadius: 14, padding: '14px',
                border: '1.5px solid var(--accent)',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <FileText className="h-5 w-5" />
              רישום היעדרות מאושרת
            </button>
          </div>
        )}

        {mode === 'checkout' && (
          <form onSubmit={handleCheckOut} className="flex flex-col gap-4">
            <div className="flex rounded-lg p-1 gap-1" style={{ border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.5)' }}>
              {(['today', 'multiday'] as const).map((t) => (
                <button
                  key={t} type="button" onClick={() => setExitType(t)}
                  style={{
                    flex: 1, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 500,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: exitType === t ? 'var(--accent)' : 'transparent',
                    color: exitType === t ? '#fff' : 'var(--ink-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {t === 'today' ? 'חזרה היום' : 'יציאה לכמה ימים'}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sv-reason">סיבת היציאה (אופציונלי)</Label>
              <Input id="sv-reason" placeholder="לדוגמה: ביקור משפחה..." value={reason} onChange={(e) => setReason(e.target.value)} />
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
                  <Label htmlFor="sv-date" className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />תאריך חזרה</Label>
                  <Input id="sv-date" type="date" value={returnDate} min={todayStr} max={maxDateStr} onChange={(e) => setReturnDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sv-time2" className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />שעה (אופציונלי)</Label>
                  <Input id="sv-time2" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">חזור</Button>
              <Button type="submit" className="flex-1" style={{ background: 'var(--warn)', color: '#fff' }}
                disabled={isSubmitting || (exitType === 'multiday' && !returnDate)}>
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />רושם...</> : 'אישור יציאה'}
              </Button>
            </div>
          </form>
        )}

        {mode === 'request' && (
          <form onSubmit={handleRequest} className="flex flex-col gap-4">
            <div style={{ borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent-soft)', padding: '10px 14px' }}>
              <p style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>כאחראי כיתה, ההיעדרות תאושר מיידית ותישלח הודעה לתלמיד</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-start" className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />תאריך יציאה</Label>
                <Input id="req-start" type="date" value={reqStartDate} min={todayStr} onChange={(e) => setReqStartDate(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-end" className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />תאריך חזרה</Label>
                <Input id="req-end" type="date" value={reqEndDate} min={reqStartDate || todayStr} onChange={(e) => setReqEndDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-stime" className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />שעת יציאה</Label>
                <Input id="req-stime" type="time" value={reqStartTime} onChange={(e) => setReqStartTime(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="req-etime" className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />שעת חזרה</Label>
                <Input id="req-etime" type="time" value={reqEndTime} onChange={(e) => setReqEndTime(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="req-reason">סיבה</Label>
              <Input id="req-reason" placeholder="לדוגמה: שמחת משפחה..." value={reqReason} onChange={(e) => setReqReason(e.target.value)} required />
            </div>
            <button
              type="button"
              onClick={() => setReqIsUrgent(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                borderRadius: 12, padding: '10px 14px', textAlign: 'right',
                border: `2px solid ${reqIsUrgent ? 'var(--accent)' : 'var(--hairline)'}`,
                background: reqIsUrgent ? 'var(--accent-soft)' : 'rgba(255,255,255,0.6)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <ShieldAlert style={{ width: 20, height: 20, color: reqIsUrgent ? 'var(--accent)' : 'var(--ink-faint)', flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: reqIsUrgent ? 'var(--accent)' : 'var(--ink)' }}>מצב חריג</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>לא נספר במכסה הרגילה</span>
              </div>
              <div style={{
                marginInlineStart: 'auto', width: 20, height: 20, borderRadius: '50%',
                border: `2px solid ${reqIsUrgent ? 'var(--accent)' : 'var(--hairline)'}`,
                background: reqIsUrgent ? 'var(--accent)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {reqIsUrgent && <X size={10} color="#fff" />}
              </div>
            </button>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode(null)} className="flex-1">חזור</Button>
              <Button type="submit" className="flex-1" style={{ background: 'var(--accent)', color: '#fff' }}
                disabled={isSubmitting || !reqStartDate || !reqReason}>
                {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />רושם...</> : 'אשר היעדרות'}
              </Button>
            </div>
          </form>
        )}

        {mode === null && (
          <Button type="button" variant="ghost" onClick={handleClose} className="mt-4 w-full" style={{ color: 'var(--ink-muted)' }}>ביטול</Button>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const p = name.trim().split(' ')
  return p.length >= 2 ? `${p[0][0]}${p[p.length - 1][0]}` : name.substring(0, 2)
}
function getAvatarHue(id: string): string {
  const hues = [220, 270, 150, 30, 0, 200, 170, 320]
  let h = 0; for (let i = 0; i < id.length; i++) { h = (h << 5) - h + id.charCodeAt(i); h |= 0 }
  return `hsl(${hues[Math.abs(h) % hues.length]} 55% 40%)`
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export function ClassSupervisorDashboard() {
  const { classSupervisor, logout } = useAuthStore()
  const [students, setStudents] = useState<Student[]>([])
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [todayDepartures, setTodayDepartures] = useState<CalendarDeparture[]>([])
  const [, setTick] = useState(0)
  const [manualAuditActive, setManualAuditActive] = useState(false)
  const [auditPresence, setAuditPresence] = useState<Map<string, boolean>>(new Map())
  const [showAuditWarning, setShowAuditWarning] = useState(false)

  const classId = classSupervisor?.classId ?? ''
  const gradeName = classSupervisor?.gradeName ?? ''

  const loadData = async () => {
    if (!classId) return
    try {
      const [sts, cs, activeDeps] = await Promise.all([
        api.getStudents({ classId }),
        api.getClassStats(),
        api.listDepartures({ classId, status: ['ACTIVE', 'APPROVED'] }),
      ])
      setStudents(sts as Student[])
      setClassStats(cs)
      const todayStr = new Date().toISOString().slice(0, 10)
      setTodayDepartures(
        activeDeps.filter((d) => d.start_at.slice(0, 10) === todayStr && minsFromNow(d.end_at) > -60)
      )
    } catch (err) {
      toast({ title: 'שגיאה בטעינת נתוני כיתה', description: getErrorMessage(err, 'טעינת נתוני אחראי הכיתה נכשלה'), variant: 'destructive' })
    } finally { setIsLoading(false) }
  }

  // Coalesce bursts of realtime events into a single refetch.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleReload = () => {
    if (reloadTimerRef.current) return
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null
      loadData()
    }, 1500)
  }

  useEffect(() => {
    if (!classId) return
    loadData()
    const ch = supabase.channel(`supervisor-students-${classId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `classId=eq.${classId}` }, scheduleReload)
      .subscribe()
    const tick = setInterval(() => setTick((t) => t + 1), 60000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(tick)
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [classId])

  useDeparturesRealtime({ classId, onAnyChange: scheduleReload })

  useEffect(() => {
    if (!classId) return
    const ch = supabase.channel('audit-control')
      .on('broadcast', { event: 'manual_audit_start' }, ({ payload }) => {
        const { classIds } = payload as { classIds: string[] }
        if (classIds.includes(classId)) { setManualAuditActive(true); setAuditPresence(new Map()) }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [classId])

  if (!classSupervisor) return null

  const quota = calcQuota(students.length)
  const classLabel = classId.includes(' כיתה ') ? `כיתה ${classId.split(' כיתה ')[1]}` : classId
  const classOnCampus = students.filter(s => s.currentStatus === 'ON_CAMPUS').length
  const classOffCampus = students.filter(s => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length
  const classTotal = students.length
  const yeshivaQuota = classStats.reduce((sum, cs) => sum + calcQuota(cs.total), 0)
  const yeshivaOut = classStats.reduce((sum, cs) => sum + cs.offCampus, 0)
  const yeshivaSpots = Math.max(0, yeshivaQuota - yeshivaOut)
  const hasLocationData = students.some(s => s.lastLocation !== null)
  const locationCounts = students.reduce((acc, s) => {
    const cat = getStudentLocation(s); acc[cat] = (acc[cat] ?? 0) + 1; return acc
  }, {} as Record<LocationCategory, number>)
  const gradeLevelClasses = classStats.filter(cs => cs.grade === gradeName).sort((a, b) => a.classId.localeCompare(b.classId, 'he'))
  const spotsColor = yeshivaSpots === 0 ? 'var(--bad)' : yeshivaSpots <= 3 ? 'var(--warn)' : 'var(--good)'
  const unmarkedCount = students.length - auditPresence.size

  const handleFinishAudit = () => {
    if (unmarkedCount > 0) { setShowAuditWarning(true) }
    else { setManualAuditActive(false); setAuditPresence(new Map()) }
  }

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: 'var(--parchment)', position: 'relative' }}>
      {/* Ambient orbs */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div className="orb-3" />
        <div className="orb-4" />
      </div>

      {/* Sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
        borderBottom: '1px solid var(--hairline)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <GraduationCap size={18} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{gradeName}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{classLabel} — אחראי כיתה</div>
          </div>
        </div>
        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.6)',
            color: 'var(--ink-muted)', fontSize: 12.5, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <LogOut size={13} />
          יציאה
        </button>
      </header>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 100px' }}>

        {/* Manual audit banner */}
        {manualAuditActive && (
          <div style={{
            borderRadius: 16, padding: 16,
            border: '1px solid var(--warn)',
            background: 'var(--warn-soft)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ShieldAlert size={18} style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <p style={{ fontWeight: 600, color: 'var(--warn)', fontSize: 14 }}>ביקורת פנימית פעילה — סמן נוכחות</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {students.map((s) => {
                const present = auditPresence.get(s.id)
                return (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderRadius: 10, background: 'rgba(255,255,255,0.7)',
                    padding: '8px 12px',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{s.fullName}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setAuditPresence((prev) => new Map(prev).set(s.id, true))}
                        style={{
                          borderRadius: 7, padding: '3px 10px', fontSize: 11.5, fontWeight: 700,
                          cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                          background: present === true ? 'var(--good)' : 'rgba(34,197,94,0.12)',
                          color: present === true ? '#fff' : 'var(--good)',
                        }}
                      >נוכח</button>
                      <button
                        onClick={() => setAuditPresence((prev) => new Map(prev).set(s.id, false))}
                        style={{
                          borderRadius: 7, padding: '3px 10px', fontSize: 11.5, fontWeight: 700,
                          cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                          background: present === false ? 'var(--bad)' : 'rgba(239,68,68,0.12)',
                          color: present === false ? '#fff' : 'var(--bad)',
                        }}
                      >נעדר</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <button
              onClick={handleFinishAudit}
              style={{
                width: '100%', borderRadius: 10, padding: '10px',
                background: 'var(--warn)', border: 'none', color: '#fff',
                fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              סיום ביקורת
              {unmarkedCount > 0 && (
                <span style={{ marginInlineStart: 8, borderRadius: 999, background: 'rgba(255,255,255,0.3)', padding: '1px 7px', fontSize: 11 }}>
                  {unmarkedCount} לא מסומנים
                </span>
              )}
            </button>
          </div>
        )}

        {/* Class stats card */}
        <div className="glass" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={15} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{classLabel}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{gradeName}</div>
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="font-mono-num" style={{ fontSize: 36, fontWeight: 700, color: spotsColor, lineHeight: 1 }}>
                {isLoading ? '—' : yeshivaSpots}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>מקומות פנויים בישיבה</div>
            </div>
          </div>

          <div style={{ height: 8, borderRadius: 999, background: 'rgba(15,23,42,0.08)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 999,
              background: spotsColor,
              width: `${isLoading || yeshivaQuota === 0 ? 0 : Math.min(100, Math.round((yeshivaOut / yeshivaQuota) * 100))}%`,
              transition: 'width 0.7s ease',
            }} />
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 13 }}>
            {[
              { dot: 'var(--good)', label: 'בישיבה', val: classOnCampus },
              { dot: 'var(--warn)', label: 'בחוץ', val: classOffCampus },
              { dot: 'var(--hairline)', label: `מכסה ${classOffCampus}/${quota}`, val: null },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.dot, flexShrink: 0 }} />
                <span style={{ color: 'var(--ink-muted)' }}>
                  {item.val !== null ? `${item.label}: ` : ''}<strong style={{ color: item.val !== null && i === 1 && classOffCampus >= quota ? 'var(--bad)' : 'var(--ink)' }}>{item.val !== null ? item.val : item.label}</strong>
                </span>
              </div>
            ))}
          </div>

          {hasLocationData && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hairline)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <p style={{ width: '100%', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={11} /> מיקום (ביקורת)
              </p>
              {(['inYeshiva', 'inArea', 'far'] as LocationCategory[]).map(cat => {
                const count = locationCounts[cat] ?? 0
                if (count === 0) return null
                const cfg = LOCATION_CFG[cat]
                return (
                  <div key={cat} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    borderRadius: 999, border: '1px solid var(--hairline)',
                    background: 'rgba(255,255,255,0.5)',
                    padding: '3px 10px', fontSize: 11.5,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--ink-muted)' }}>{cfg.label}</span>
                    <span style={{ fontWeight: 700, color: cfg.color }}>{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Grade-level spots */}
        {gradeLevelClasses.length > 1 && (
          <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertOctagon size={14} style={{ color: 'var(--info)' }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>מצב השכבה — {gradeName}</span>
              </div>
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {gradeLevelClasses.map(cs => {
                const isSelf = cs.classId === classId
                const cQuota = calcQuota(cs.total)
                const spotsUsed = cs.offCampus
                const spotsLeft = Math.max(0, cQuota - spotsUsed)
                const isFull = spotsLeft === 0
                const cLabel = cs.classId.includes(' כיתה ') ? `כיתה ${cs.classId.split(' כיתה ')[1]}` : cs.classId
                const cPct = cs.total > 0 ? Math.round((cs.onCampus / cs.total) * 100) : 0
                const c = isFull ? 'var(--bad)' : spotsLeft <= 1 ? 'var(--warn)' : 'var(--good)'
                return (
                  <div key={cs.classId} style={{
                    position: 'relative', borderRadius: 12, padding: 10,
                    border: `1.5px solid ${isSelf ? 'var(--accent)' : 'var(--hairline)'}`,
                    background: isSelf ? 'var(--accent-soft)' : 'rgba(255,255,255,0.5)',
                  }}>
                    {isSelf && (
                      <span style={{
                        position: 'absolute', top: -8, insetInlineEnd: 8,
                        borderRadius: 999, background: 'var(--accent)', color: '#fff',
                        padding: '1px 7px', fontSize: 9, fontWeight: 700,
                      }}>הכיתה שלי</span>
                    )}
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>{cLabel}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--ink-faint)' }}>{cPct}% נוכחים</span>
                      <span style={{ fontWeight: 700, color: c }}>{isFull ? 'מלאה' : `${spotsLeft} מקומות`}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 999, background: 'rgba(15,23,42,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, width: `${cPct}%`, background: c, transition: 'width 0.5s' }} />
                    </div>
                    <div style={{ fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 3 }}>
                      {cs.onCampus}/{cs.total} בישיבה · {spotsUsed}/{cQuota} מכסה
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Student list */}
        <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>תלמידי {classLabel}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{classOnCampus}/{classTotal} נוכחים</span>
          </div>

          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--ink-faint)' }} />
            </div>
          ) : students.length === 0 ? (
            <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13.5, color: 'var(--ink-faint)' }}>אין תלמידים בכיתה זו</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {students
                .sort((a, b) => {
                  const aOut = a.currentStatus !== 'ON_CAMPUS' ? 0 : 1
                  const bOut = b.currentStatus !== 'ON_CAMPUS' ? 0 : 1
                  if (aOut !== bOut) return aOut - bOut
                  return a.fullName.localeCompare(b.fullName, 'he')
                })
                .map(student => {
                  const isOut = student.currentStatus === 'OFF_CAMPUS' || student.currentStatus === 'OVERDUE'
                  const locCat = getStudentLocation(student)
                  const locCfg = LOCATION_CFG[locCat]
                  const showLoc = hasLocationData && isOut && student.lastLocation
                  const avatarColor = getAvatarHue(student.id)

                  return (
                    <li
                      key={student.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '0 14px', minHeight: 62,
                        borderBottom: '1px solid var(--hairline)',
                        background: isOut ? 'rgba(249,115,22,0.04)' : 'transparent',
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: `${avatarColor}22`,
                        border: `1.5px solid ${avatarColor}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11.5, fontWeight: 700, color: avatarColor,
                      }}>
                        {getInitials(student.fullName)}
                      </div>

                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {student.fullName}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <StatusBadge status={student.currentStatus} />
                          {showLoc && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 500, color: locCfg.color }}>
                              <MapPin size={10} />
                              {locCfg.label}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => setEditStudent(student)}
                        style={{
                          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                          border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.6)',
                          color: 'var(--ink-faint)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <ArrowRightLeft size={13} />
                      </button>
                    </li>
                  )
                })}
            </ul>
          )}
        </div>

        {/* Today's departures */}
        {todayDepartures.length > 0 && (
          <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={14} style={{ color: 'var(--info)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>יציאות היום ({todayDepartures.length})</span>
            </div>
            <div>
              {todayDepartures.map((dep) => {
                const minsEnd = minsFromNow(dep.end_at)
                const minsStart = minsFromNow(dep.start_at)
                const isActive = minsStart <= 0 && minsEnd > 0
                const isPending = minsStart > 0
                return (
                  <div key={dep.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--hairline)',
                  }}>
                    <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink)', flex: 1 }}>{dep.student_name}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', flexShrink: 0 }}>{getTimeStr(dep.start_at)}–{getTimeStr(dep.end_at)}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0, color: isActive ? 'var(--warn)' : isPending ? 'var(--info)' : 'var(--ink-faint)' }}>
                      {isActive ? `נותרו ${minsEnd} דק'` : isPending ? `בעוד ${minsStart} דק'` : 'הסתיים'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Audit warning dialog */}
      <Dialog open={showAuditWarning} onOpenChange={setShowAuditWarning}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5" style={{ color: 'var(--warn)' }} />
              יש תלמידים לא מסומנים
            </DialogTitle>
            <DialogDescription>
              {unmarkedCount} תלמיד{unmarkedCount !== 1 ? 'ים' : ''} עדיין לא סומנו. לסיים בכל זאת?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowAuditWarning(false)} className="flex-1">חזור לסימון</Button>
            <Button className="flex-1" style={{ background: 'var(--warn)', color: '#fff' }}
              onClick={() => { setShowAuditWarning(false); setManualAuditActive(false); setAuditPresence(new Map()) }}>
              סיים בכל זאת
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <EditStudentSheet
        student={editStudent}
        open={editStudent !== null}
        onClose={() => setEditStudent(null)}
        onSuccess={loadData}
      />
    </div>
  )
}
