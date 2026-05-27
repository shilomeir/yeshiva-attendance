import type { AuditClassRow } from '../domain/auditSummary'

interface AuditClassMatrixProps {
  classRows: AuditClassRow[]
  selectedClassId: string | null
  onSelect: (classId: string | null) => void
}

export function AuditClassMatrix({ classRows, selectedClassId, onSelect }: AuditClassMatrixProps) {
  if (classRows.length === 0) return null

  return (
    <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>מצב לפי כיתות</h3>
        {selectedClassId && (
          <button
            onClick={() => onSelect(null)}
            style={{
              padding: '4px 10px', borderRadius: 999,
              background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
              fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-muted)', cursor: 'pointer',
            }}
          >
            נקה סינון
          </button>
        )}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 8,
      }}>
        {classRows.map((c) => {
          const active = selectedClassId === c.classId
          return (
            <button
              key={c.classId}
              onClick={() => onSelect(active ? null : c.classId)}
              style={{
                textAlign: 'right', padding: '10px 12px', borderRadius: 12,
                background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.65)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--hairline)'}`,
                fontFamily: 'inherit', color: 'var(--ink)', cursor: 'pointer',
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'baseline', marginBottom: 6,
              }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                  {c.classId.replace(/^כיתה\s+/, '')}
                </span>
                <span style={{
                  fontSize: 11, color: 'var(--ink-faint)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {c.checked}/{c.total}
                </span>
              </div>
              {/* Progress */}
              <div style={{
                height: 5, borderRadius: 999, background: 'rgba(0,0,0,0.06)',
                overflow: 'hidden', marginBottom: 6,
              }}>
                <div style={{
                  height: '100%',
                  width: `${c.completionPct}%`,
                  background: c.exceptions > 0 ? 'var(--bad)' : 'var(--good)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              {/* Tags */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 10.5 }}>
                {c.exceptions > 0 && <Pill label={`חריג ${c.exceptions}`} tone="var(--bad)"  />}
                {c.needsSupervisor > 0 && <Pill label={`רכז ${c.needsSupervisor}`} tone="var(--warn)" />}
                {c.approvedOutside > 0 && <Pill label={`אישור ${c.approvedOutside}`} tone="var(--good)" />}
                {c.pending > 0 && <Pill label={`ממתין ${c.pending}`} tone="var(--ink-faint)" />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 999,
      background: 'rgba(255,255,255,0.7)',
      border: `1px solid ${tone}`,
      color: tone, fontWeight: 600,
    }}>
      {label}
    </span>
  )
}
