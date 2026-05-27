import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { AuditLiveBoardRow } from '../api/auditTypes'
import { deriveFromRow, getAuditStatusDisplay } from '../domain/auditStatus'

interface AuditStudentTableProps {
  rows: AuditLiveBoardRow[]
  showLocation: boolean
  classFilter?: string | null
  onMarkClick?: (row: AuditLiveBoardRow) => void
}

function toneColor(tone: ReturnType<typeof getAuditStatusDisplay>['tone']): string {
  switch (tone) {
    case 'good':    return 'var(--good)'
    case 'bad':     return 'var(--bad)'
    case 'warn':    return 'var(--warn)'
    case 'info':    return 'var(--info)'
    case 'neutral': return 'var(--ink-faint)'
  }
}

const TONE_ORDER: Record<string, number> = {
  bad: 0, warn: 1, info: 2, neutral: 3, good: 4,
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function AuditStudentTable({ rows, showLocation, classFilter, onMarkClick }: AuditStudentTableProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim()
    return rows
      .filter((r) => !classFilter || r.class_id === classFilter)
      .filter((r) => {
        if (!q) return true
        return r.student_name.includes(q) || r.id_number.includes(q) || r.class_id.includes(q)
      })
      .sort((a, b) => {
        const da = deriveFromRow(a); const db = deriveFromRow(b)
        const oa = TONE_ORDER[getAuditStatusDisplay(da).tone]
        const ob = TONE_ORDER[getAuditStatusDisplay(db).tone]
        if (oa !== ob) return oa - ob
        return a.student_name.localeCompare(b.student_name, 'he')
      })
  }, [rows, classFilter, search])

  return (
    <div className="glass" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--hairline)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 140 }}>
          תלמידים {classFilter ? `· ${classFilter.replace(/^כיתה\s+/, '')}` : ''}
        </h3>
        <div style={{ position: 'relative', minWidth: 220, flex: 1 }}>
          <Search size={13} style={{
            position: 'absolute', insetInlineStart: 10, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--ink-faint)', pointerEvents: 'none',
          }} />
          <input
            placeholder="חפש שם / ת.ז / כיתה"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '7px 10px 7px 32px', borderRadius: 10,
              background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
              fontSize: 12.5, fontFamily: 'inherit', outline: 'none', color: 'var(--ink)',
              direction: 'rtl',
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{filtered.length} שורות</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
          לא נמצאו תלמידים
        </div>
      ) : (
        <div style={{ maxHeight: 540, overflowY: 'auto' }}>
          {filtered.map((row) => {
            const derived = deriveFromRow(row)
            const display = getAuditStatusDisplay(derived)
            const color = toneColor(display.tone)
            return (
              <div
                key={row.student_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: showLocation
                    ? 'minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto'
                    : 'minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr) auto',
                  gap: 10, alignItems: 'center',
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--hairline)',
                  borderInlineStart: `3px solid ${color}`,
                  background: display.isCritical ? 'rgba(239,68,68,0.04)' : undefined,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.student_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                    {row.class_id.replace(/^כיתה\s+/, '')} · ת.ז. {row.id_number}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: color, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color }}>
                    {display.label}
                  </span>
                </div>
                {showLocation ? (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                    {row.distance_from_campus_meters !== null
                      ? <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{row.distance_from_campus_meters} מ׳</span>
                      : '—'}
                  </div>
                ) : null}
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {formatTime(row.captured_at ?? row.manual_updated_at)}
                </div>
                {onMarkClick && (
                  <button
                    onClick={() => onMarkClick(row)}
                    style={{
                      padding: '4px 10px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
                      fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-muted)', cursor: 'pointer',
                    }}
                  >
                    סמן
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
