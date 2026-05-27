import { useEffect, useState } from 'react'
import { Clock, StopCircle, Tv, Wifi, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useRealtimeConnectionState } from '../hooks/useRealtimeConnectionState'
import type { AuditSession } from '../api/auditTypes'

interface AuditCommandHeaderProps {
  session: AuditSession
  onComplete: () => void
  onCancel: () => void
  busy?: boolean
}

function formatElapsed(startIso: string | null): string {
  if (!startIso) return '—'
  const ms = Date.now() - new Date(startIso).getTime()
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function AuditCommandHeader({ session, onComplete, onCancel, busy }: AuditCommandHeaderProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsed = formatElapsed(session.started_at)
  const isClosing = session.status === 'CLOSING'
  const rt = useRealtimeConnectionState()
  const rtColor = rt === 'connected' ? 'var(--good)' : rt === 'degraded' ? 'var(--bad)' : 'var(--warn)'
  const rtLabel = rt === 'connected' ? 'חיבור חי פעיל' : rt === 'degraded' ? 'החיבור החי מתעדכן מחדש' : 'מתחבר...'

  return (
    <div
      className="glass"
      style={{
        padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        borderInlineStart: '3px solid var(--accent)',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--accent)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--good)', boxShadow: '0 0 0 4px rgba(16,185,129,0.18)',
            display: 'inline-block', animation: 'admin-shimmer-pulse 1.4s ease-in-out infinite',
          }} />
          ביקורת פעילה
        </div>
        <h2 style={{
          fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500,
          letterSpacing: '-0.02em', marginTop: 2, color: 'var(--ink)',
        }}>
          {session.title}
        </h2>
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} />
            זמן מתחילת ביקורת: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink-muted)' }}>{elapsed}</span>
          </span>
          <span style={{ color: 'var(--hairline-2)' }}>·</span>
          <span>{session.mode === 'LOCATION' ? 'מצב: עם מיקום' : 'מצב: ידנית'}</span>
          <span style={{ color: 'var(--hairline-2)' }}>·</span>
          <span title={rtLabel} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(255,255,255,0.55)', border: `1px solid ${rtColor}`,
            color: rtColor, fontWeight: 600,
          }}>
            {rt === 'connected' ? <Wifi size={11} /> : <WifiOff size={11} />}
            {rtLabel}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="outline" asChild size="sm">
          <Link to={`/admin/rollcall/${session.id}/projection`}>
            <Tv size={14} />
            מסך הקרנה
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          ביטול
        </Button>
        <Button size="sm" onClick={onComplete} disabled={busy || isClosing}>
          <StopCircle size={14} />
          {busy ? 'סוגר...' : 'סיים ביקורת'}
        </Button>
      </div>
    </div>
  )
}
