import { useEffect, useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Clock, Download, RefreshCw, AlertCircle, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type {
  AuditSessionWithDetails,
  AuditEntry,
  AuditEntryStatus,
  AuditEntrySource,
  AuditClassStateStatus,
  AuditSessionStatus,
} from '@/types'

function entryStatusLabel(s: AuditEntryStatus | null): string {
  if (s === 'IN_YESHIVA') return 'בישיבה'
  if (s === 'OUT_WITH_PERMISSION') return "ביצ' רשות"
  if (s === 'OUT_WITHOUT_PERMISSION') return "ביצ' ללא רשות"
  return 'לא סומן'
}

function entrySourceLabel(src: AuditEntrySource): string {
  if (src === 'SUPERVISOR') return 'אחראי'
  if (src === 'AUTO_DEFAULT') return 'אוטומטי (יציאה פעילה)'
  return 'אוטומטי (GPS)'
}

function sessionStatusLabel(s: AuditSessionStatus): string {
  if (s === 'ACTIVE') return 'פעילה'
  if (s === 'CLOSED') return 'סגורה'
  if (s === 'TIMED_OUT') return 'פג תוקף'
  return 'בוטלה'
}

function sessionStatusBadge(s: AuditSessionStatus): string {
  if (s === 'ACTIVE')
    return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
  if (s === 'CLOSED')
    return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
  return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600'
}

function classStateLabel(s: AuditClassStateStatus) {
  if (s === 'FINISHED') return 'הסתיים'
  if (s === 'IN_PROGRESS') return 'בתהליך'
  return 'לא התחיל'
}

function classStateBadge(s: AuditClassStateStatus) {
  if (s === 'FINISHED')
    return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
  if (s === 'IN_PROGRESS')
    return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
  return 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-600'
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusIcon(s: AuditEntryStatus | null) {
  if (s === 'IN_YESHIVA')
    return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
  if (s === 'OUT_WITH_PERMISSION')
    return <MinusCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
  if (s === 'OUT_WITHOUT_PERMISSION')
    return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
  return <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
}

export function AuditDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<AuditSessionWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .getAuditSession(id)
      .then((s) => {
        if (!s) setNotFound(true)
        else setSession(s)
      })
      .catch((err) => {
        toast({
          title: 'שגיאה בטעינת הביקורת',
          description: getErrorMessage(err, 'טעינת פרטי הביקורת נכשלה'),
          variant: 'destructive',
        })
      })
      .finally(() => setLoading(false))
  }, [id])

  // Combined rows: every student in the snapshot + their entry (or none).
  // Sorted by class, then by name.
  const fullRows = useMemo(() => {
    if (!session) return []
    const entriesByStudent = new Map<string, AuditEntry>()
    for (const e of session.entries) {
      if (e.studentId) entriesByStudent.set(e.studentId, e)
    }
    const rows = session.studentSnapshot.map((snap) => ({
      snap,
      entry: entriesByStudent.get(snap.id) ?? null,
    }))
    rows.sort((a, b) => {
      const c = a.snap.classId.localeCompare(b.snap.classId, 'he')
      if (c !== 0) return c
      return a.snap.fullName.localeCompare(b.snap.fullName, 'he')
    })
    return rows
  }, [session])

  const aggregates = useMemo(() => {
    if (!session) return { inYeshiva: 0, outPerm: 0, outNoPerm: 0, marked: 0, unmarked: 0, pct: 0 }
    const inYeshiva = session.entries.filter((e) => e.status === 'IN_YESHIVA').length
    const outPerm = session.entries.filter((e) => e.status === 'OUT_WITH_PERMISSION').length
    const outNoPerm = session.entries.filter((e) => e.status === 'OUT_WITHOUT_PERMISSION').length
    const marked = session.entries.length
    const total = session.totalStudentsSnapshot
    const unmarked = total - marked
    const pct = total > 0 ? Math.round((marked / total) * 100) : 0
    return { inYeshiva, outPerm, outNoPerm, marked, unmarked, pct }
  }, [session])

  const classBreakdown = useMemo(() => {
    if (!session) return []
    return session.classSnapshot.map((cls) => {
      const entries = session.entries.filter((e) => e.classId === cls.classId)
      const state = session.classStates.find((cs) => cs.classId === cls.classId)
      return {
        classId: cls.classId,
        grade: cls.grade,
        total: cls.studentCount,
        marked: entries.length,
        inYeshiva: entries.filter((e) => e.status === 'IN_YESHIVA').length,
        outPerm: entries.filter((e) => e.status === 'OUT_WITH_PERMISSION').length,
        outNoPerm: entries.filter((e) => e.status === 'OUT_WITHOUT_PERMISSION').length,
        unmarked: cls.studentCount - entries.length,
        stateStatus: (state?.status ?? 'NOT_STARTED') as AuditClassStateStatus,
      }
    })
  }, [session])

  // Master plan R-8: Excel-only export in v1 (PDF deferred to v1.1). xlsx
  // is lazy-imported so users who never export the audit don't pay for the
  // ~100KB dependency. Excel handles Hebrew/RTL natively without the BOM
  // dance the previous CSV path required.
  const handleExportExcel = async () => {
    if (!session) return
    const XLSX = await import('xlsx')
    const header = [
      'שם תלמיד',
      'ת.ז.',
      'שכבה',
      'כיתה',
      'סטטוס',
      'מקור',
      'יציאה פעילה בעת הביקורת',
      'הערה',
      'סומן ע"י',
      'זמן סימון',
    ]
    const rows = fullRows.map(({ snap, entry }) => [
      snap.fullName,
      snap.idNumber,
      snap.grade,
      snap.classId,
      entryStatusLabel(entry?.status ?? null),
      entry ? entrySourceLabel(entry.source) : '',
      entry?.hadActiveDepartureAtAudit ? 'כן' : '',
      entry?.note ?? '',
      entry?.submittedBy ?? '',
      entry ? formatTimestamp(entry.submittedAt) : '',
    ])
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [
      { wch: 22 }, // שם
      { wch: 12 }, // ת.ז.
      { wch: 14 }, // שכבה
      { wch: 22 }, // כיתה
      { wch: 14 }, // סטטוס
      { wch: 22 }, // מקור
      { wch: 12 }, // יציאה פעילה
      { wch: 30 }, // הערה
      { wch: 14 }, // סומן ע"י
      { wch: 18 }, // זמן
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ביקורת')
    const slug = (session.title ?? new Date(session.startedAt).toISOString().slice(0, 16))
      .replace(/[^\w֐-׿-]+/g, '_')
    XLSX.writeFile(wb, `ביקורת_${slug}.xlsx`)
    toast({ title: 'הקובץ הורד', description: `${rows.length} שורות יוצאו ל־Excel` })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-[var(--blue)]" />
      </div>
    )
  }

  if (notFound || !session) {
    return (
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <Link to="/admin/inspection/history" className="text-sm text-[var(--blue)] hover:underline inline-flex items-center gap-1">
          <ArrowRight className="h-3 w-3" /> חזרה להיסטוריה
        </Link>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
          <AlertCircle className="h-10 w-10 text-[var(--text-muted)] opacity-40" />
          <p className="font-medium text-[var(--text-muted)]">הביקורת לא נמצאה</p>
          <p className="text-sm text-[var(--text-muted)]">ייתכן שהמזהה שגוי או שהביקורת נמחקה</p>
        </div>
      </div>
    )
  }

  const startedAt = formatTimestamp(session.startedAt)
  const closedAt = session.closedAt ? formatTimestamp(session.closedAt) : null
  const durationSec = session.closedAt
    ? Math.round((new Date(session.closedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000)
  const durationLabel =
    durationSec < 60
      ? `${durationSec} שניות`
      : durationSec < 3600
        ? `${Math.round(durationSec / 60)} דקות`
        : `${Math.floor(durationSec / 3600)}:${String(Math.floor((durationSec % 3600) / 60)).padStart(2, '0')} שעות`

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      {/* Back link + actions */}
      <div className="flex items-center justify-between gap-3">
        <Link to="/admin/inspection/history" className="text-sm text-[var(--blue)] hover:underline inline-flex items-center gap-1">
          <ArrowRight className="h-3 w-3" /> חזרה להיסטוריה
        </Link>
        <Button variant="outline" size="sm" onClick={() => { void handleExportExcel() }}>
          <Download className="h-4 w-4" />
          ייצא Excel
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-2xl font-bold text-[var(--text)]">
            {session.title ?? 'ביקורת פנימית'}
          </h2>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${sessionStatusBadge(session.status)}`}
          >
            {sessionStatusLabel(session.status)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)]">
          <span>{session.mode === 'MANUAL' ? 'ביקורת ידנית' : 'ביקורת עם מיקום'}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {durationLabel}</span>
          <span>·</span>
          <span>{startedAt}{closedAt && ` → ${closedAt}`}</span>
          <span>·</span>
          <span>{session.classIds.length} כיתות · {session.totalStudentsSnapshot} תלמידים</span>
        </div>
      </div>

      {/* Aggregate stats + progress */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          {([
            { label: 'בישיבה', count: aggregates.inYeshiva, color: 'text-green-700 dark:text-green-400' },
            { label: "ביצ' רשות", count: aggregates.outPerm, color: 'text-blue-700 dark:text-blue-400' },
            { label: "ביצ' ללא רשות", count: aggregates.outNoPerm, color: 'text-red-700 dark:text-red-400' },
            { label: 'לא סומן', count: aggregates.unmarked, color: 'text-amber-600 dark:text-amber-400' },
          ] as const).map(({ label, count, color }) => (
            <div key={label} className="rounded-lg bg-[var(--bg-2)] p-2">
              <p className={`text-2xl font-bold ${color}`}>{count}</p>
              <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-[var(--bg-2)] overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 dark:bg-green-400"
              style={{ width: `${aggregates.pct}%` }}
            />
          </div>
          <span className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">
            {aggregates.pct}% סומנו
          </span>
        </div>
      </div>

      {/* Per-class breakdown */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          פירוט לפי כיתה
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {classBreakdown.map((cls) => {
            const clsPct = cls.total > 0 ? Math.round((cls.marked / cls.total) * 100) : 0
            return (
              <div
                key={cls.classId}
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{cls.classId}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{cls.grade}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${classStateBadge(cls.stateStatus)}`}
                  >
                    {classStateLabel(cls.stateStatus)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-2)] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${cls.stateStatus === 'FINISHED' ? 'bg-green-500' : 'bg-amber-500'}`}
                      style={{ width: `${clsPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                    {cls.marked}/{cls.total}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-green-700 dark:text-green-400">בישיבה: {cls.inYeshiva}</span>
                  <span className="text-blue-700 dark:text-blue-400">רשות: {cls.outPerm}</span>
                  {cls.outNoPerm > 0 && (
                    <span className="font-bold text-red-700 dark:text-red-400">
                      ללא רשות: {cls.outNoPerm}
                    </span>
                  )}
                  <span className="text-amber-600 dark:text-amber-400 ms-auto">
                    נותרו: {cls.unmarked}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Entries table */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          סימונים ({fullRows.length})
        </p>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {fullRows.map(({ snap, entry }) => (
              <div
                key={snap.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-2)]"
              >
                <div className="shrink-0">{statusIcon(entry?.status ?? null)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text)] truncate">{snap.fullName}</p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">
                    {snap.classId} · ת.ז. {snap.idNumber}
                  </p>
                </div>
                <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
                  <span className="text-xs font-medium text-[var(--text)]">
                    {entryStatusLabel(entry?.status ?? null)}
                  </span>
                  {entry && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {entrySourceLabel(entry.source)} · {new Date(entry.submittedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {entry?.note && (
                    <span className="text-[10px] text-red-600 dark:text-red-400 max-w-[200px] truncate">
                      {entry.note}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
