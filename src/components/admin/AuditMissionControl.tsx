import { AlertCircle, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AuditSessionWithDetails, AuditEntry, AuditClassStateStatus } from '@/types'

interface Props {
  session: AuditSessionWithDetails
  isClosing: boolean
  onClose: () => void
}

function stateLabel(s: AuditClassStateStatus) {
  if (s === 'FINISHED') return 'הסתיים'
  if (s === 'IN_PROGRESS') return 'בתהליך'
  return 'לא התחיל'
}

function stateBadgeClass(s: AuditClassStateStatus) {
  if (s === 'FINISHED')
    return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
  if (s === 'IN_PROGRESS')
    return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
  return 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-600'
}

export function AuditMissionControl({ session, isClosing, onClose }: Props) {
  const durationMins = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000)
  const durationLabel =
    durationMins < 60
      ? `${durationMins} דקות`
      : `${Math.floor(durationMins / 60)}:${String(durationMins % 60).padStart(2, '0')} שעות`

  const allEntries = session.entries as AuditEntry[]
  const totalStudents = session.totalStudentsSnapshot
  const inYeshiva = allEntries.filter((e) => e.status === 'IN_YESHIVA').length
  const outPerm = allEntries.filter((e) => e.status === 'OUT_WITH_PERMISSION').length
  const outNoPerm = allEntries.filter((e) => e.status === 'OUT_WITHOUT_PERMISSION').length
  const unmarked = totalStudents - allEntries.length
  const pct = totalStudents > 0 ? Math.round((allEntries.length / totalStudents) * 100) : 0

  const classBreakdown = session.classSnapshot.map((cls) => {
    const entries = allEntries.filter((e) => e.classId === cls.classId)
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

  // Alert queue: explicitly marked as OUT_WITHOUT_PERMISSION, or auto-flagged
  // by GPS distance (ORANGE > 1 km / RED > 5 km from campus).
  const alertEntries = allEntries
    .filter(
      (e) =>
        e.status === 'OUT_WITHOUT_PERMISSION' ||
        e.distanceBucket === 'ORANGE' ||
        e.distanceBucket === 'RED',
    )
    .map((e) => ({ entry: e, student: session.studentSnapshot[e.studentSnapshotIdx] }))
    .filter(({ student }) => student != null)

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-amber-700 dark:text-amber-300 text-base">
            ביקורת פעילה{session.title && ` — ${session.title}`}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{session.mode === 'MANUAL' ? 'ביקורת ידנית' : 'ביקורת עם מיקום'}</span>
            <span>·</span>
            <span>{session.classIds.length} כיתות</span>
            <span>·</span>
            <span>{totalStudents} תלמידים</span>
            <span>·</span>
            <Clock className="h-3 w-3" />
            <span>{durationLabel}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={isClosing}
          className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/50 shrink-0"
        >
          <X className="h-4 w-4" />
          סגור ביקורת
        </Button>
      </div>

      {/* Aggregate stats */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-2 text-center">
          {([
            { label: 'בישיבה', count: inYeshiva, color: 'text-green-700 dark:text-green-400' },
            { label: "ביצ' רשות", count: outPerm, color: 'text-blue-700 dark:text-blue-400' },
            { label: "ביצ' ללא רשות", count: outNoPerm, color: 'text-red-700 dark:text-red-400' },
            { label: 'לא סומן', count: unmarked, color: 'text-amber-600 dark:text-amber-400' },
          ] as const).map(({ label, count, color }) => (
            <div key={label} className="rounded-lg bg-white/60 dark:bg-amber-900/20 p-2">
              <p className={`text-lg font-bold ${color}`}>{count}</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-amber-200 dark:bg-amber-800/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 dark:bg-green-400 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300 whitespace-nowrap">
            {pct}% סומנו
          </span>
        </div>
      </div>

      {/* Per-class breakdown */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
          מצב לפי כיתה
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {classBreakdown.map((cls) => {
            const clsPct = cls.total > 0 ? Math.round((cls.marked / cls.total) * 100) : 0
            return (
              <div
                key={cls.classId}
                className="rounded-lg bg-white/70 dark:bg-amber-900/20 border border-white/80 dark:border-amber-800/40 p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] leading-tight truncate">
                      {cls.classId}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">{cls.grade}</p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${stateBadgeClass(cls.stateStatus)}`}
                  >
                    {stateLabel(cls.stateStatus)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-amber-100 dark:bg-amber-800/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        cls.stateStatus === 'FINISHED' ? 'bg-green-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${clsPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
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

      {/* Alert queue: OUT_WITHOUT_PERMISSION */}
      {alertEntries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              יצאו ללא רשות ({alertEntries.length})
            </p>
          </div>
          <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-white/70 dark:bg-red-950/20 divide-y divide-red-100 dark:divide-red-900/30">
            {alertEntries.map(({ entry, student }) => {
              const distanceLabel =
                entry.distanceFromCampusM == null
                  ? null
                  : entry.distanceFromCampusM < 1000
                    ? `${Math.round(entry.distanceFromCampusM)} מ׳`
                    : `${(entry.distanceFromCampusM / 1000).toFixed(1)} ק״מ`
              const bucketColor =
                entry.distanceBucket === 'RED'
                  ? 'text-red-700 dark:text-red-400 font-bold'
                  : entry.distanceBucket === 'ORANGE'
                    ? 'text-orange-700 dark:text-orange-400'
                    : 'text-[var(--text-muted)]'
              const isExplicit = entry.status === 'OUT_WITHOUT_PERMISSION'
              return (
                <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-[10px] font-bold text-red-700 dark:text-red-300">
                    {student.fullName.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{student.fullName}</p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">
                      {entry.classId}
                      {!isExplicit && entry.distanceBucket && ' · GPS'}
                    </p>
                  </div>
                  <div className="text-end shrink-0 flex flex-col items-end gap-0.5">
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {new Date(entry.submittedAt).toLocaleTimeString('he-IL', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {distanceLabel && (
                      <p className={`text-[10px] ${bucketColor}`}>{distanceLabel}</p>
                    )}
                    {entry.note && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 max-w-[120px] truncate">
                        {entry.note}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {session.mode === 'MANUAL' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          אחראי הכיתות מסמנים נוכחות בלוח הבקרה שלהם
        </p>
      )}
    </div>
  )
}
