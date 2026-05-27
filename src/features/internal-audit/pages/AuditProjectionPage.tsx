import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { auditApi } from '../api/auditApi'
import { useAuditDashboardData } from '../hooks/useAuditDashboardData'
import { useAuditRealtime } from '../hooks/useAuditRealtime'
import { computeMetrics, groupByClass } from '../domain/auditSummary'
import { deriveFromRow, getAuditStatusDisplay } from '../domain/auditStatus'
import type { AuditSession } from '../api/auditTypes'

const ROTATION_SECONDS = 15

type View = 'overview' | 'classes' | 'live' | 'alerts'

const VIEWS: View[] = ['overview', 'classes', 'live', 'alerts']

/**
 * Big-screen projection view. Full-screen, no chrome, auto-rotates between
 * Overview / Classes / Live Feed / Alerts. Reads same realtime data as the
 * admin dashboard but renders for an audience.
 */
export function AuditProjectionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<AuditSession | null>(null)
  const [view, setView] = useState<View>('overview')
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    auditApi.getSession(sessionId).then(setSession).catch(() => setSession(null))
  }, [sessionId])

  useAuditRealtime({
    sessionId: sessionId ?? null,
    onAnyChange: () => {
      if (!sessionId) return
      auditApi.getSession(sessionId).then(setSession).catch(() => {})
    },
  })

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      setView((v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length])
    }, ROTATION_SECONDS * 1000)
    return () => clearInterval(id)
  }, [paused])

  const { rows, alerts } = useAuditDashboardData(sessionId ?? null)
  const metrics = useMemo(() => computeMetrics(rows), [rows])
  const classRows = useMemo(() => groupByClass(rows), [rows])

  if (!sessionId) return <Empty>חסר מזהה סשן</Empty>
  if (!session) return <Empty>טוען...</Empty>

  return (
    <div
      dir="rtl"
      style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(120% 80% at 50% 0%, #1e1b2e 0%, #0f0e18 70%)',
        color: 'white', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Heebo, system-ui, sans-serif',
      }}
      onClick={() => setPaused((p) => !p)}
    >
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '24px 36px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 14, letterSpacing: '0.24em', textTransform: 'uppercase', opacity: 0.6 }}>
            ביקורת פנימית · {session.status === 'ACTIVE' ? 'פעילה' : session.status === 'COMPLETED' ? 'הסתיימה' : session.status}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 44, fontWeight: 500, letterSpacing: '-0.02em', marginTop: 4 }}>
            {session.title}
          </h1>
        </div>
        <div style={{ textAlign: 'left', opacity: 0.8 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.6 }}>
            {VIEW_LABEL[view]}
          </div>
          <div style={{ fontSize: 28, fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>
            {metrics.completionPct}%
          </div>
        </div>
      </div>

      {/* View */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '24px 36px' }}>
        {view === 'overview' && <OverviewView metrics={metrics} />}
        {view === 'classes'  && <ClassesView classRows={classRows} />}
        {view === 'live'     && <LiveFeedView rows={rows} />}
        {view === 'alerts'   && <AlertsView rows={rows} alerts={alerts} />}
      </div>

      {/* Bottom bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 36px', borderTop: '1px solid rgba(255,255,255,0.08)',
        fontSize: 13, opacity: 0.55,
      }}>
        <span>{paused ? 'מושהה — לחיצה מחדש מפעילה רוטציה' : `מסך הבא בעוד ${ROTATION_SECONDS} שניות`}</span>
        <span>סה״כ {metrics.total} תלמידים</span>
      </div>
    </div>
  )
}

const VIEW_LABEL: Record<View, string> = {
  overview: 'סקירה כללית',
  classes:  'מצב לפי כיתות',
  live:     'תגובות אחרונות',
  alerts:   'חריגים',
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f0e18', color: 'white', fontSize: 22, fontFamily: 'Heebo, system-ui',
    }}>
      {children}
    </div>
  )
}

function OverviewView({ metrics }: { metrics: ReturnType<typeof computeMetrics> }) {
  const items = [
    { label: 'נבדקו',          value: metrics.checked,         tone: '#3b82f6' },
    { label: 'נוכחים',         value: metrics.onCampus,        tone: '#10b981' },
    { label: 'יציאה מאושרת',   value: metrics.approvedOutside, tone: '#22c55e' },
    { label: 'חריגים',         value: metrics.exceptions,      tone: '#ef4444' },
    { label: 'דורש רכז',       value: metrics.needsSupervisor, tone: '#f59e0b' },
    { label: 'ממתינים',        value: metrics.pending,         tone: '#6b7280' },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24,
      height: '100%', alignContent: 'center',
    }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            padding: 32, borderRadius: 24,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderInlineStart: `4px solid ${it.tone}`,
          }}
        >
          <div style={{ fontSize: 18, opacity: 0.75 }}>{it.label}</div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 88,
            fontWeight: 700, lineHeight: 1, marginTop: 4, color: it.tone,
          }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function ClassesView({ classRows }: { classRows: ReturnType<typeof groupByClass> }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: 16, overflowY: 'auto', height: '100%', alignContent: 'start',
    }}>
      {classRows.map((c) => (
        <div key={c.classId} style={{
          padding: 20, borderRadius: 16,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{c.classId.replace(/^כיתה\s+/, '')}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, opacity: 0.75 }}>
              {c.checked}/{c.total}
            </span>
          </div>
          <div style={{
            height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden', marginTop: 12, marginBottom: 12,
          }}>
            <div style={{
              height: '100%', width: `${c.completionPct}%`,
              background: c.exceptions > 0 ? '#ef4444' : '#10b981', transition: 'width 0.4s',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, opacity: 0.8 }}>
            <span style={{ color: '#10b981' }}>נוכחים {c.onCampus}</span>
            {c.exceptions > 0 && <span style={{ color: '#ef4444' }}>חריגים {c.exceptions}</span>}
            {c.needsSupervisor > 0 && <span style={{ color: '#f59e0b' }}>רכז {c.needsSupervisor}</span>}
            {c.pending > 0 && <span style={{ color: '#9ca3af' }}>ממתין {c.pending}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function LiveFeedView({ rows }: { rows: ReturnType<typeof useAuditDashboardData>['rows'] }) {
  const sorted = [...rows]
    .filter((r) => r.captured_at || r.manual_updated_at)
    .sort((a, b) => +new Date(b.captured_at ?? b.manual_updated_at!) - +new Date(a.captured_at ?? a.manual_updated_at!))
    .slice(0, 14)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
      {sorted.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', fontSize: 22, opacity: 0.55 }}>
          ממתין לתגובות תלמידים...
        </div>
      )}
      {sorted.map((row) => {
        const display = getAuditStatusDisplay(deriveFromRow(row))
        const tone = display.tone === 'good' ? '#10b981'
                   : display.tone === 'bad'  ? '#ef4444'
                   : display.tone === 'warn' ? '#f59e0b'
                   : display.tone === 'info' ? '#3b82f6'
                   : '#9ca3af'
        const stamp = row.captured_at ?? row.manual_updated_at!
        return (
          <div key={row.student_id} style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto auto',
            alignItems: 'center', gap: 18,
            padding: '12px 18px', borderRadius: 12,
            background: 'rgba(255,255,255,0.04)',
            borderInlineStart: `4px solid ${tone}`,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: tone }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{row.student_name}</div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>{row.class_id.replace(/^כיתה\s+/, '')}</div>
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: tone }}>{display.label}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, opacity: 0.75 }}>
              {new Date(stamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AlertsView({ rows, alerts }: {
  rows: ReturnType<typeof useAuditDashboardData>['rows']
  alerts: ReturnType<typeof useAuditDashboardData>['alerts']
}) {
  const open = alerts.filter((a) => !a.resolved_at)
  const studentNameById = new Map(rows.map((r) => [r.student_id, { name: r.student_name, classId: r.class_id }]))

  if (open.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 28, color: '#10b981', opacity: 0.85 }}>
        אין חריגים פתוחים — הכל תקין
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
      {open.slice(0, 10).map((alert) => {
        const tone = alert.severity === 'CRITICAL' ? '#ef4444' : alert.severity === 'WARNING' ? '#f59e0b' : '#3b82f6'
        const meta = studentNameById.get(alert.student_id)
        return (
          <div key={alert.id} style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'center',
            padding: '16px 20px', borderRadius: 14,
            background: 'rgba(255,255,255,0.04)', borderInlineStart: `4px solid ${tone}`,
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{meta?.name ?? alert.student_id}</div>
              <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
                {meta?.classId.replace(/^כיתה\s+/, '')} · {alert.message}
              </div>
            </div>
            <span style={{
              padding: '4px 14px', borderRadius: 999,
              background: tone, color: 'white', fontSize: 14, fontWeight: 700,
            }}>
              {alert.severity}
            </span>
          </div>
        )
      })}
    </div>
  )
}
