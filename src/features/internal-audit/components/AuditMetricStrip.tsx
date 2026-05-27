import { CheckCircle2, AlertOctagon, Clock, Users, ShieldCheck, HelpCircle } from 'lucide-react'
import type { AuditMetrics } from '../domain/auditSummary'

interface AuditMetricStripProps {
  metrics: AuditMetrics
}

export function AuditMetricStrip({ metrics }: AuditMetricStripProps) {
  const cards: Array<{
    label: string; value: number; tone: string; icon: React.ReactNode
  }> = [
    { label: 'נבדקו',          value: metrics.checked,         tone: 'var(--info)', icon: <Users size={18} /> },
    { label: 'נוכחים בישיבה',  value: metrics.onCampus,        tone: 'var(--good)', icon: <CheckCircle2 size={18} /> },
    { label: 'יציאה מאושרת',   value: metrics.approvedOutside, tone: 'var(--good)', icon: <ShieldCheck size={18} /> },
    { label: 'חריגים',         value: metrics.exceptions,      tone: 'var(--bad)',  icon: <AlertOctagon size={18} /> },
    { label: 'דורש רכז',       value: metrics.needsSupervisor, tone: 'var(--warn)', icon: <HelpCircle size={18} /> },
    { label: 'ממתינים',        value: metrics.pending,         tone: 'var(--ink-faint)', icon: <Clock size={18} /> },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="glass"
          style={{
            padding: '14px 16px', borderRadius: 14,
            borderInlineStart: `3px solid ${c.tone}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: c.tone }}>{c.icon}</span>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 26, fontWeight: 700, color: 'var(--ink)',
            }}>
              {c.value}
            </span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>{c.label}</div>
        </div>
      ))}
      <div
        className="glass"
        style={{
          padding: '14px 16px', borderRadius: 14,
          gridColumn: 'span 1', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500 }}>השלמת ביקורת</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 26, fontWeight: 700, color: 'var(--accent)' }}>
            {metrics.completionPct}
          </span>
          <span style={{ fontSize: 14, color: 'var(--ink-faint)' }}>%</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${metrics.completionPct}%`,
            background: 'var(--accent)', transition: 'width 0.4s ease',
          }} />
        </div>
      </div>
    </div>
  )
}
