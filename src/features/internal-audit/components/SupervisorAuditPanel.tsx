import { useState } from 'react'
import { ShieldAlert, CheckCircle2, AlertOctagon, ShieldCheck, CheckCircle } from 'lucide-react'
import { auditApi } from '../api/auditApi'
import { useSupervisorAuditBoard } from '../hooks/useSupervisorAuditBoard'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { AuditSession, AuditClassBoardRow, AuditManualMarkStatus } from '../api/auditTypes'

interface SupervisorAuditPanelProps {
  session: AuditSession
  classId: string
  supervisorId: string
}

const MANUAL_OPTIONS: Array<{ value: AuditManualMarkStatus; label: string; tone: string; icon: React.ReactNode }> = [
  { value: 'PRESENT',            label: 'נוכח',                 tone: 'var(--good)', icon: <CheckCircle2 size={14} /> },
  { value: 'OUTSIDE_APPROVED',   label: 'בחוץ עם אישור',         tone: 'var(--info)', icon: <ShieldCheck size={14} /> },
  { value: 'OUTSIDE_UNAPPROVED', label: 'בחוץ ללא אישור',        tone: 'var(--bad)',  icon: <AlertOctagon size={14} /> },
]

function needsSupervisor(row: AuditClassBoardRow): boolean {
  // Already manually marked → no action needed
  if (row.manual_status) return false
  // Approved departure → already resolved
  if (row.expected_state === 'APPROVED_OUTSIDE') return false
  // Manual-mode session OR failed/missing location
  return (
    !row.location_status ||
    row.location_status === 'DENIED_BY_USER' ||
    row.location_status === 'UNAVAILABLE' ||
    row.location_status === 'TIMEOUT' ||
    row.location_status === 'FAILED' ||
    row.location_status === 'PENDING' ||
    row.location_status === 'REQUEST_SENT' ||
    row.location_status === 'APP_OPENED'
  )
}

export function SupervisorAuditPanel({ session, classId, supervisorId }: SupervisorAuditPanelProps) {
  const { rows, isLoading } = useSupervisorAuditBoard(session.id, classId)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const handleMark = async (row: AuditClassBoardRow, status: AuditManualMarkStatus) => {
    setSavingId(row.student_id)
    try {
      await auditApi.recordManualMark({
        sessionId: session.id,
        studentId: row.student_id,
        status,
        markedBy: supervisorId,
        markedByRole: 'SUPERVISOR',
      })
    } catch (err) {
      toast({
        title: 'שגיאה בסימון',
        description: getErrorMessage(err, 'שמירת הסימון נכשלה'),
        variant: 'destructive',
      })
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
        טוען נתוני ביקורת...
      </div>
    )
  }

  const pending = rows.filter(needsSupervisor)
  const resolved = rows.filter((r) => !needsSupervisor(r))
  const total = rows.length
  const marked = total - pending.length
  const pct = total > 0 ? Math.round((marked / total) * 100) : 0
  const allDone = pending.length === 0

  // Once supervisor presses "סיימתי סימון" AND all are marked, collapse to a small confirmation.
  // Closing the actual audit remains the admin's responsibility (spec §13.5).
  if (dismissed && allDone) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        borderRadius: 12, padding: '10px 14px',
        background: 'var(--good-soft, rgba(16,185,129,0.10))',
        border: '1px solid var(--good)',
      }}>
        <CheckCircle size={16} style={{ color: 'var(--good)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--good)' }}>
          סיימת סימון — ממתין לסגירת ביקורת ע״י המנהל
        </span>
        <button
          onClick={() => setDismissed(false)}
          style={{
            marginInlineStart: 'auto', padding: '3px 8px', borderRadius: 7,
            background: 'rgba(255,255,255,0.8)', border: '1px solid var(--hairline)',
            fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-muted)', cursor: 'pointer',
          }}
        >
          הצג שוב
        </button>
      </div>
    )
  }

  return (
    <div style={{
      borderRadius: 16, padding: 16,
      border: `1px solid ${allDone ? 'var(--good)' : 'var(--warn)'}`,
      background: allDone ? 'rgba(16,185,129,0.06)' : 'var(--warn-soft)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <ShieldAlert size={18} style={{ color: allDone ? 'var(--good)' : 'var(--warn)', flexShrink: 0 }} />
        <p style={{ fontWeight: 600, color: allDone ? 'var(--good)' : 'var(--warn)', fontSize: 14 }}>
          ביקורת פנימית פעילה — {session.mode === 'LOCATION' ? 'מצב מיקום' : 'מצב ידני'}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
          <span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--ink)' }}>{marked}/{total}</span> סומנו</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.5)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: allDone ? 'var(--good)' : 'var(--warn)',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
        {allDone
          ? 'כל תלמידי הכיתה אומתו. אפשר להמתין לסיום הביקורת ע״י המנהל.'
          : `נדרש סימון של ${pending.length} תלמידים. סימון רכז מופיע מיידית אצל המנהל.`}
      </p>

      {pending.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {pending.map((r) => (
            <StudentRow
              key={r.student_id}
              row={r}
              busy={savingId === r.student_id}
              onSelect={(status) => handleMark(r, status)}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
            הצג תלמידים שכבר אומתו ({resolved.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {resolved.map((r) => (
              <StudentRow
                key={r.student_id}
                row={r}
                busy={savingId === r.student_id}
                onSelect={(status) => handleMark(r, status)}
                resolved
              />
            ))}
          </div>
        </details>
      )}

      {allDone && (
        <button
          onClick={() => setDismissed(true)}
          style={{
            marginTop: 12, width: '100%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--good)', border: 'none', color: '#fff',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <CheckCircle size={15} />
          סיימתי סימון
        </button>
      )}
    </div>
  )
}

interface StudentRowProps {
  row: AuditClassBoardRow
  busy: boolean
  resolved?: boolean
  onSelect: (status: AuditManualMarkStatus) => void
}

function StudentRow({ row, busy, resolved, onSelect }: StudentRowProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderRadius: 10, padding: '8px 12px',
      background: 'rgba(255,255,255,0.85)',
      opacity: resolved ? 0.7 : 1,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{row.student_name}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
          {row.expected_state === 'APPROVED_OUTSIDE'
            ? row.approved_departure_label ?? 'יציאה מאושרת'
            : row.manual_status
              ? `סומן: ${manualLabel(row.manual_status)}`
              : statusLabel(row.location_status)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {MANUAL_OPTIONS.map((opt) => {
          const active = row.manual_status === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              disabled={busy}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
                background: active ? opt.tone : 'rgba(255,255,255,0.7)',
                border: `1px solid ${active ? opt.tone : 'var(--hairline)'}`,
                color: active ? '#fff' : opt.tone,
                transition: 'all 0.15s',
              }}
            >
              {opt.icon}
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function manualLabel(s: AuditManualMarkStatus): string {
  return MANUAL_OPTIONS.find((o) => o.value === s)?.label ?? s
}

function statusLabel(s: AuditClassBoardRow['location_status']): string {
  switch (s) {
    case null:
    case 'PENDING':         return 'ממתין למיקום'
    case 'REQUEST_SENT':    return 'התראה נשלחה'
    case 'APP_OPENED':      return 'התלמיד פתח את האפליקציה'
    case 'GRANTED':         return 'מיקום התקבל'
    case 'LOW_ACCURACY':    return 'מיקום בדיוק נמוך'
    case 'DENIED_BY_USER':  return 'התלמיד דחה הרשאה'
    case 'UNAVAILABLE':     return 'מיקום לא זמין'
    case 'TIMEOUT':         return 'פג תוקף בקשת המיקום'
    case 'FAILED':          return 'איסוף מיקום נכשל'
    default:                return s
  }
}
