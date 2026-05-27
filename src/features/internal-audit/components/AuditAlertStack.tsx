import { useState } from 'react'
import { AlertTriangle, AlertOctagon, Info, CheckSquare } from 'lucide-react'
import { auditApi } from '../api/auditApi'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { AuditAlert, AuditLiveBoardRow } from '../api/auditTypes'

interface AuditAlertStackProps {
  alerts: AuditAlert[]
  rows: AuditLiveBoardRow[]
}

const TYPE_LABEL: Record<string, string> = {
  OUT_OF_RANGE:              'מחוץ לטווח',
  NO_RESPONSE:               'לא נענה',
  LOCATION_DENIED:           'הרשאת מיקום נדחתה',
  LOCATION_FAILED:           'מיקום לא נאסף',
  MANUAL_OUTSIDE_UNAPPROVED: 'בחוץ ללא אישור (רכז)',
  LOW_ACCURACY:              'דיוק מיקום נמוך',
}

export function AuditAlertStack({ alerts, rows }: AuditAlertStackProps) {
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const open = alerts.filter((a) => !a.resolved_at)
  if (open.length === 0) return null

  const studentNameById = new Map(rows.map((r) => [r.student_id, { name: r.student_name, classId: r.class_id }]))

  const handleResolve = async (alertId: string) => {
    setResolvingId(alertId)
    try {
      await auditApi.resolveAlert(alertId)
    } catch (err) {
      toast({
        title: 'שגיאה',
        description: getErrorMessage(err, 'לא ניתן לסמן חריגה כטופלה'),
        variant: 'destructive',
      })
    } finally {
      setResolvingId(null)
    }
  }

  // Critical first
  const sorted = [...open].sort((a, b) => {
    const order = (s: string) => (s === 'CRITICAL' ? 0 : s === 'WARNING' ? 1 : 2)
    const da = order(a.severity); const db = order(b.severity)
    if (da !== db) return da - db
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return (
    <div className="glass" style={{ padding: 14, borderRadius: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <AlertOctagon size={15} style={{ color: 'var(--bad)' }} />
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>חריגים פתוחים</h3>
        <span style={{
          fontSize: 11, padding: '1px 8px', borderRadius: 999,
          background: 'var(--bad)', color: 'white', fontWeight: 700,
        }}>
          {open.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((alert) => {
          const tone = alert.severity === 'CRITICAL' ? 'var(--bad)' : alert.severity === 'WARNING' ? 'var(--warn)' : 'var(--info)'
          const meta = studentNameById.get(alert.student_id)
          const Icon = alert.severity === 'CRITICAL' ? AlertOctagon : alert.severity === 'WARNING' ? AlertTriangle : Info
          return (
            <div
              key={alert.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                gap: 10, alignItems: 'center',
                padding: '8px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.6)',
                borderInlineStart: `3px solid ${tone}`,
              }}
            >
              <Icon size={15} style={{ color: tone }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                  {meta?.name ?? alert.student_id}
                  <span style={{ fontWeight: 400, color: 'var(--ink-faint)', marginInlineStart: 8 }}>
                    {meta?.classId?.replace(/^כיתה\s+/, '') ?? ''}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                  {TYPE_LABEL[alert.type] ?? alert.type} · {alert.message}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'JetBrains Mono, monospace' }}>
                {new Date(alert.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <button
                onClick={() => handleResolve(alert.id)}
                disabled={resolvingId === alert.id}
                title="סמן כטופל"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.8)', border: `1px solid ${tone}`,
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  color: tone, cursor: resolvingId === alert.id ? 'wait' : 'pointer',
                }}
              >
                <CheckSquare size={11} />
                טיפלתי
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
