import { useStudentAuditCollector } from '../hooks/useStudentAuditCollector'
import { useActiveAuditSession } from '../hooks/useActiveAuditSession'
import { CheckCircle2, AlertOctagon, MapPin, ShieldCheck, AlertTriangle } from 'lucide-react'

interface StudentAuditCollectorProps {
  studentId: string | undefined
}

/**
 * Renders a banner on the student home page when an audit session is active.
 * Automatically triggers GPS collection. Surfaces the collector state to the user.
 */
export function StudentAuditCollector({ studentId }: StudentAuditCollectorProps) {
  const { session } = useActiveAuditSession()
  const state = useStudentAuditCollector({ studentId, session })

  if (!session) return null
  if (session.status !== 'ACTIVE') return null

  // Manual-mode sessions don't ask the student for anything
  if (session.mode === 'MANUAL') {
    return (
      <Banner
        tone="info"
        icon={<ShieldCheck size={16} />}
        title="ביקורת פנימית פעילה"
        body="אחראי הכיתה שלך יסמן את הנוכחות. אין צורך לפעול."
      />
    )
  }

  switch (state.phase) {
    case 'idle':
    case 'detecting':
      return (
        <Banner
          tone="info"
          icon={<MapPin size={16} className="animate-pulse" />}
          title="ביקורת פנימית פעילה"
          body="מזהה את הסשן הפעיל..."
        />
      )
    case 'collecting':
      return (
        <Banner
          tone="info"
          icon={<MapPin size={16} className="animate-pulse" />}
          title="מבצע אימות מיקום"
          body="הדפדפן מבקש הרשאת מיקום. אנא אשר."
        />
      )
    case 'sent':
      return (
        <Banner
          tone={state.locationClass === 'OUT_OF_RANGE' ? 'bad' : 'good'}
          icon={state.locationClass === 'OUT_OF_RANGE' ? <AlertOctagon size={16} /> : <CheckCircle2 size={16} />}
          title="המיקום נשלח"
          body={
            state.distance !== null
              ? `מרחק מהישיבה: ${state.distance} מטר`
              : 'תודה — המיקום התקבל בהצלחה'
          }
        />
      )
    case 'denied':
      return (
        <Banner
          tone="warn"
          icon={<AlertTriangle size={16} />}
          title="לא ניתנה הרשאת מיקום"
          body="אחראי הכיתה יסמן אותך ידנית."
        />
      )
    case 'approved_outside':
      return (
        <Banner
          tone="good"
          icon={<ShieldCheck size={16} />}
          title="יציאה מאושרת"
          body="אתה מסומן אוטומטית — אין צורך לשלוח מיקום."
        />
      )
    case 'failed':
      return (
        <Banner
          tone="warn"
          icon={<AlertTriangle size={16} />}
          title="לא הצלחנו לקבל מיקום"
          body="אחראי הכיתה יטפל בסימון."
        />
      )
  }
}

type Tone = 'good' | 'bad' | 'warn' | 'info'

interface BannerProps {
  tone: Tone
  icon: React.ReactNode
  title: string
  body: string
}

function Banner({ tone, icon, title, body }: BannerProps) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--info)'
  const bg    = tone === 'good' ? 'rgba(16,185,129,0.10)' : tone === 'bad' ? 'rgba(239,68,68,0.10)' : tone === 'warn' ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.10)'
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderRadius: 14,
        background: bg, borderInlineStart: `3px solid ${color}`,
        margin: '12px 0',
      }}
    >
      <div style={{ color, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{body}</div>
      </div>
    </div>
  )
}
