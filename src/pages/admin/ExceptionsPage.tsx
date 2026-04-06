import { useEffect, useState, useCallback } from 'react'
import { AlertOctagon, Phone, User, Clock, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Student, AbsenceRequest } from '@/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return 'לא ידוע'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `לפני ${diffMins} דקות`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `לפני ${diffHours} שעות`
  const diffDays = Math.floor(diffHours / 24)
  return `לפני ${diffDays} ימים`
}

// ─── types ───────────────────────────────────────────────────────────────────

interface CategorisedStudents {
  noApproval: Student[]
  withApproval: Student[]
  withUrgent: Student[]
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  count: number
  colorClass: string
  bgClass: string
  borderClass: string
}

function SectionHeader({ icon, title, count, colorClass, bgClass, borderClass }: SectionHeaderProps) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${bgClass} ${borderClass}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgClass}`}>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${colorClass}`}>{title}</p>
      </div>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${colorClass} ${bgClass} border ${borderClass}`}>
        {count}
      </span>
    </div>
  )
}

interface StudentCardProps {
  student: Student
  variant: 'overdue' | 'noApproval' | 'withApproval' | 'withUrgent'
}

function StudentCard({ student: s, variant }: StudentCardProps) {
  const isOverdue = variant === 'overdue'
  const isNoApproval = variant === 'noApproval'
  const isUrgent = variant === 'withUrgent'

  const borderColor =
    isOverdue     ? 'border-red-200 dark:border-red-800/40'
    : isNoApproval ? 'border-orange-200 dark:border-orange-800/40'
    : isUrgent     ? 'border-indigo-200 dark:border-indigo-800/40'
    :                'border-blue-200 dark:border-blue-800/40'

  const bgColor =
    isOverdue     ? 'bg-red-50/60 dark:bg-red-950/10'
    : isNoApproval ? 'bg-orange-50/60 dark:bg-orange-950/10'
    : isUrgent     ? 'bg-indigo-50/60 dark:bg-indigo-950/10'
    :                'bg-blue-50/60 dark:bg-blue-950/10'

  const lastSeenColor =
    isOverdue     ? 'text-red-600 dark:text-red-400'
    : isNoApproval ? 'text-orange-600 dark:text-orange-400'
    : isUrgent     ? 'text-indigo-600 dark:text-indigo-400'
    :                'text-blue-600 dark:text-blue-400'

  return (
    <Card className={`border ${borderColor} ${bgColor}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: student info */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-2)]">
                <User className="h-4 w-4 text-[var(--text-muted)]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text)] leading-tight">{s.fullName}</p>
                <p className="text-xs text-[var(--text-muted)]">{s.classId}</p>
              </div>
            </div>

            <p className="text-xs text-[var(--text-muted)] pr-10">ת.ז. {s.idNumber}</p>

            {/* Time since last seen */}
            <div className={`flex items-center gap-1.5 pr-10 text-xs font-medium ${lastSeenColor}`}>
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {isOverdue
                ? <span>באיחור — נעדר {timeAgo(s.lastSeen)}</span>
                : <span>יצא {timeAgo(s.lastSeen)}</span>
              }
            </div>

            {/* Warning badge — no approval */}
            {isNoApproval && (
              <div className="pr-10">
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  <AlertTriangle className="h-3 w-3" />
                  ללא אישור
                </span>
              </div>
            )}

            {/* Urgent badge */}
            {isUrgent && (
              <div className="pr-10">
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  <ShieldCheck className="h-3 w-3" />
                  אישור חריג
                </span>
              </div>
            )}
          </div>

          {/* Right: phone button */}
          {s.phone && (
            <a
              href={`tel:${s.phone}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-[var(--blue)] shadow-sm hover:bg-blue-50 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">{s.phone}</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────

export function ExceptionsPage() {
  const [categorised, setCategorised] = useState<CategorisedStudents>({
    noApproval: [],
    withApproval: [],
    withUrgent: [],
  })
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const todayStr = new Date().toISOString().split('T')[0]

      const [allStudents, approvedRequests] = await Promise.all([
        api.getStudents(),
        api.getAbsenceRequests({ status: 'APPROVED' }) as Promise<AbsenceRequest[]>,
      ])

      // Students currently outside or overdue
      const outsideStudents = allStudents.filter(
        (s: Student) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE'
      )

      // Approved requests covering today
      const validApproved = approvedRequests.filter(
        (r: AbsenceRequest) => r.date <= todayStr && (!r.endDate || r.endDate >= todayStr)
      )
      const approvedSet = new Set(validApproved.map((r: AbsenceRequest) => r.studentId))
      const urgentSet = new Set(
        validApproved.filter((r: AbsenceRequest) => r.isUrgent).map((r: AbsenceRequest) => r.studentId)
      )

      // Categorise (all outside students — OVERDUE treated same as OFF_CAMPUS)
      const noApproval = outsideStudents.filter((s: Student) => !approvedSet.has(s.id))
      const withUrgent = outsideStudents.filter((s: Student) => urgentSet.has(s.id))
      const withApproval = outsideStudents.filter(
        (s: Student) => approvedSet.has(s.id) && !urgentSet.has(s.id)
      )

      setCategorised({ noApproval, withApproval, withUrgent })
    } catch {
      console.error('Failed to load exceptions data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()

    const studentsChannel = supabase
      .channel('exceptions-students')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        loadData()
      })
      .subscribe()

    const requestsChannel = supabase
      .channel('exceptions-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests' }, () => {
        loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(studentsChannel)
      supabase.removeChannel(requestsChannel)
    }
  }, [loadData])

  const totalOutside =
    categorised.noApproval.length +
    categorised.withApproval.length +
    categorised.withUrgent.length

  // ── loading ──
  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-[var(--text-muted)]">
        <p>טוען חריגות...</p>
      </div>
    )
  }

  // ── empty state ──
  if (totalOutside === 0) {
    return (
      <div className="flex flex-col gap-6 p-4 lg:p-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">חריגות עכשיו</h2>
          <p className="text-sm text-[var(--text-muted)]">מעקב בזמן אמת אחר תלמידים מחוץ לישיבה</p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-green-200 bg-green-50/60 py-16 dark:border-green-800/40 dark:bg-green-950/10">
          <CheckCircle className="h-14 w-14 text-green-500" />
          <p className="text-lg font-semibold text-green-700 dark:text-green-400">
            אין חריגות — כל התלמידים בישיבה
          </p>
        </div>
      </div>
    )
  }

  // ── main view ──
  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">חריגות עכשיו</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {totalOutside} תלמידים מחוץ לישיבה כרגע
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/20">
          <AlertOctagon className="h-5 w-5 text-[var(--red)]" />
        </div>
      </div>

      {/* ── Category 1: OFF_CAMPUS without approval ── */}
      {categorised.noApproval.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<AlertTriangle className="h-4.5 w-4.5" />}
            title="בחוץ ללא אישור"
            count={categorised.noApproval.length}
            colorClass="text-orange-600 dark:text-orange-400"
            bgClass="bg-orange-50 dark:bg-orange-950/20"
            borderClass="border-orange-200 dark:border-orange-800/40"
          />
          {categorised.noApproval.map((s) => (
            <StudentCard key={s.id} student={s} variant="noApproval" />
          ))}
        </section>
      )}

      {/* ── Category 4: OFF_CAMPUS with urgent approval ── */}
      {categorised.withUrgent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<ShieldCheck className="h-4.5 w-4.5" />}
            title="בחוץ חריג"
            count={categorised.withUrgent.length}
            colorClass="text-indigo-600 dark:text-indigo-400"
            bgClass="bg-indigo-50 dark:bg-indigo-950/20"
            borderClass="border-indigo-200 dark:border-indigo-800/40"
          />
          {categorised.withUrgent.map((s) => (
            <StudentCard key={s.id} student={s} variant="withUrgent" />
          ))}
        </section>
      )}

      {/* ── Category 3: OFF_CAMPUS with regular approval ── */}
      {categorised.withApproval.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader
            icon={<CheckCircle className="h-4.5 w-4.5" />}
            title="בחוץ באישור"
            count={categorised.withApproval.length}
            colorClass="text-blue-600 dark:text-blue-400"
            bgClass="bg-blue-50 dark:bg-blue-950/20"
            borderClass="border-blue-200 dark:border-blue-800/40"
          />
          {categorised.withApproval.map((s) => (
            <StudentCard key={s.id} student={s} variant="withApproval" />
          ))}
        </section>
      )}
    </div>
  )
}
