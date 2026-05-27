import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import type { AuditLiveBoardRow } from '../api/auditTypes'
import { deriveFromRow, getAuditStatusDisplay } from '../domain/auditStatus'

interface FeedEvent {
  id: string
  at: string
  studentName: string
  classId: string
  label: string
  tone: ReturnType<typeof getAuditStatusDisplay>['tone']
}

function toneColor(tone: FeedEvent['tone']): string {
  switch (tone) {
    case 'good':    return 'var(--good)'
    case 'bad':     return 'var(--bad)'
    case 'warn':    return 'var(--warn)'
    case 'info':    return 'var(--info)'
    case 'neutral': return 'var(--ink-faint)'
  }
}

interface AuditLiveFeedProps {
  rows: AuditLiveBoardRow[]
  max?: number
}

export function AuditLiveFeed({ rows, max = 12 }: AuditLiveFeedProps) {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const seenRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    // Detect new "captured" rows (location captured_at or manual_updated_at changed)
    const fresh: FeedEvent[] = []
    for (const row of rows) {
      const key = row.student_id
      const stamp = row.captured_at ?? row.manual_updated_at
      if (!stamp) continue
      const previous = seenRef.current.get(key)
      if (previous === stamp) continue
      seenRef.current.set(key, stamp)
      const display = getAuditStatusDisplay(deriveFromRow(row))
      fresh.push({
        id: `${row.student_id}-${stamp}`,
        at: stamp,
        studentName: row.student_name,
        classId: row.class_id,
        label: display.label,
        tone: display.tone,
      })
    }
    if (fresh.length === 0) return
    setEvents((prev) => {
      const combined = [...fresh.sort((a, b) => +new Date(b.at) - +new Date(a.at)), ...prev]
      return combined.slice(0, max)
    })
  }, [rows, max])

  return (
    <div className="glass" style={{ padding: 14, borderRadius: 14, minHeight: 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Activity size={15} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>זרם אירועים חי</h3>
      </div>
      {events.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
          ממתין לתגובות...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map((e) => {
            const c = toneColor(e.tone)
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.55)',
                  borderInlineStart: `2px solid ${c}`,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{e.studentName}</span>
                  <span style={{ color: 'var(--ink-faint)', marginInlineStart: 6 }}>
                    · {e.classId.replace(/^כיתה\s+/, '')}
                  </span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: c }}>{e.label}</span>
                <span style={{ fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-faint)' }}>
                  {new Date(e.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
