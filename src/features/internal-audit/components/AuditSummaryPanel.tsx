import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { AuditSession } from '../api/auditTypes'

interface AuditSummaryPanelProps {
  session: AuditSession
  onReturnHome: () => void
}

const ROW_LABELS: Array<[keyof NonNullable<AuditSession['summary']>, string]> = [
  ['totalParticipants',       'סך משתתפים'],
  ['totalClasses',            'מספר כיתות'],
  ['onCampusByLocation',      'נוכחים לפי מיקום'],
  ['approvedOutside',         'יציאה מאושרת'],
  ['outOfRange',              'מחוץ לטווח'],
  ['manualPresent',           'סומן ע״י רכז: נוכח'],
  ['manualOutsideApproved',   'סומן ע״י רכז: בחוץ עם אישור'],
  ['manualOutsideUnapproved', 'סומן ע״י רכז: בחוץ ללא אישור'],
  ['noResponse',              'לא נענו'],
  ['criticalAlerts',          'חריגים קריטיים'],
  ['warningAlerts',           'אזהרות'],
]

export function AuditSummaryPanel({ session, onReturnHome }: AuditSummaryPanelProps) {
  const summary = session.summary

  return (
    <div className="glass" style={{ padding: 24, borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <CheckCircle2 size={22} style={{ color: 'var(--good)' }} />
        <div>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
            הביקורת הסתיימה
          </h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
            {session.title} · {session.ended_at
              ? new Date(session.ended_at).toLocaleString('he-IL')
              : ''}
          </p>
        </div>
      </div>

      {summary ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 6,
        }}>
          {ROW_LABELS.map(([key, label]) => (
            <div
              key={key}
              style={{
                padding: '10px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.7)',
                border: '1px solid var(--hairline)',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{label}</div>
              <div style={{
                fontSize: 22, fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--ink)',
              }}>
                {summary[key] ?? 0}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>אין סיכום זמין</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button variant="outline" onClick={onReturnHome}>חזור לדף הביקורת</Button>
        <Button asChild>
          <Link to="/admin/rollcall/history">ביקורות קודמות</Link>
        </Button>
      </div>
    </div>
  )
}
