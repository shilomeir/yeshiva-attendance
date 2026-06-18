import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { Check, X, Clock, AlertOctagon, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage, getResultErrorMessage } from '@/lib/errors'
import type { CalendarDeparture } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.slice(0, 2)
  const hue = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `hsl(${hue}, 55%, 72%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: `hsl(${hue}, 55%, 28%)`, fontSize: size * 0.35, fontWeight: 700,
    }}>
      {initials}
    </div>
  )
}

export function PendingRequestsPage() {
  const [pending, setPending] = useState<CalendarDeparture[]>([])
  const [activeByClass, setActiveByClass] = useState<Record<string, CalendarDeparture[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [adminNote, setAdminNote] = useState<Record<string, string>>({})
  const [acting, setActing] = useState<Record<string, boolean>>({})

  const loadRequests = useCallback(async () => {
    setIsLoading(true)
    try {
      const [pendingDeps, activeDeps] = await Promise.all([
        api.listDepartures({ status: 'PENDING' }),
        api.listDepartures({ status: 'ACTIVE' }),
      ])
      setPending(pendingDeps)

      const byClass: Record<string, CalendarDeparture[]> = {}
      for (const d of activeDeps) {
        if (!byClass[d.class_id]) byClass[d.class_id] = []
        byClass[d.class_id].push(d)
      }
      setActiveByClass(byClass)
    } catch (err) {
      toast({ title: 'שגיאה בטעינת בקשות', description: getErrorMessage(err, 'טעינת הבקשות הממתינות נכשלה'), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadRequests() }, [])

  useDeparturesRealtime({ onAnyChange: loadRequests })

  const act = async (depId: string, action: () => Promise<unknown>, successMsg: string, failMsg: string) => {
    setActing((prev) => ({ ...prev, [depId]: true }))
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'error' in result) {
        toast({ title: failMsg, description: getResultErrorMessage(result, failMsg), variant: 'destructive' })
      } else {
        toast({ title: successMsg })
      }
    } catch (err) {
      toast({ title: failMsg, description: getErrorMessage(err, failMsg), variant: 'destructive' })
    } finally {
      setActing((prev) => ({ ...prev, [depId]: false }))
    }
  }

  const handleApprove = (dep: CalendarDeparture) =>
    act(dep.id, () => api.approveDeparture(dep.id, 'admin', 'ADMIN', adminNote[dep.id]), 'הבקשה אושרה', 'שגיאה באישור')

  const handleReject = (dep: CalendarDeparture) =>
    act(dep.id, () => api.rejectDeparture(dep.id, 'admin', 'ADMIN', adminNote[dep.id]), 'הבקשה נדחתה', 'שגיאה בדחייה')

  const handleCancel = (dep: CalendarDeparture) =>
    act(dep.id, () => api.cancelDeparture(dep.id, 'admin', 'ADMIN', 'בוטל ע"י מנהל'), 'הבקשה בוטלה', 'שגיאה בביטול')

  const urgentRequests = pending.filter((d) => d.is_urgent)
  const regularRequests = pending.filter((d) => !d.is_urgent)

  const RequestCard = ({ dep }: { dep: CalendarDeparture }) => {
    const isActing = acting[dep.id] ?? false
    const classActive = activeByClass[dep.class_id] ?? []
    const start = new Date(dep.start_at)
    const end = new Date(dep.end_at)
    const startDate = format(start, 'EEEE, d בMMMM yyyy', { locale: he })
    const durationMins = Math.round((end.getTime() - start.getTime()) / 60000)

    return (
      <div className="glass" style={{
        padding: 'var(--card-pad)',
        borderInlineStart: dep.is_urgent ? '3px solid var(--bad)' : '3px solid var(--hairline-2)',
        position: 'relative', overflow: 'hidden',
      }}>
        {dep.is_urgent && (
          <div style={{
            position: 'absolute', top: 0, insetInlineEnd: 0,
            padding: '4px 10px', fontSize: 10.5, fontWeight: 700,
            background: 'var(--bad)', color: 'white',
            borderBottomLeftRadius: 10,
            letterSpacing: '0.08em',
          }}>חריגה</div>
        )}

        {/* Student */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Avatar name={dep.student_name} size={44} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{dep.student_name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{dep.grade} · {dep.class_id}</div>
          </div>
        </div>

        {/* Details */}
        <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.55)', border: '1px solid var(--hairline)', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Clock size={14} style={{ color: 'var(--ink-muted)' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{startDate}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: dep.reason ? 10 : 0 }}>
            <Clock size={14} style={{ color: 'var(--ink-muted)', visibility: 'hidden' }} />
            <span className="font-mono-num" style={{ fontSize: 13, color: 'var(--ink)' }}>
              {getTimeStr(dep.start_at)} – {getTimeStr(dep.end_at)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginInlineStart: 'auto' }}>
              ({durationMins} דק')
            </span>
          </div>
          {dep.reason && (
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 10 }}>
              <span style={{ fontWeight: 500 }}>סיבה:</span> {dep.reason}
            </div>
          )}
        </div>

        {/* Quota context */}
        {!dep.is_urgent && classActive.length > 0 && (
          <div style={{
            padding: 12, borderRadius: 10, marginBottom: 12,
            background: 'var(--warn-soft)', border: '1px solid rgba(234,88,12,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Users size={13} style={{ color: 'var(--warn)' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warn)' }}>
                כרגע מחוץ לישיבה מאותה כיתה:
              </span>
            </div>
            {classActive.map((d) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--warn)', marginBottom: 2 }}>
                <span>{d.student_name}</span>
                <span>חזרה {getTimeStr(d.end_at)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Note */}
        <input
          value={adminNote[dep.id] ?? ''}
          onChange={(e) => setAdminNote((prev) => ({ ...prev, [dep.id]: e.target.value }))}
          placeholder="הערה לתלמיד (אופציונלי)"
          disabled={isActing}
          style={{
            width: '100%', padding: '8px 12px', marginBottom: 10, boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
            borderRadius: 10, fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
            textAlign: 'right', direction: 'rtl', color: 'var(--ink)',
          }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => handleReject(dep)} disabled={isActing} style={{
            flex: 1, padding: '10px 12px', borderRadius: 10,
            background: 'var(--bad-soft)', color: 'var(--bad)',
            border: 'none', fontWeight: 600, fontSize: 13.5,
            cursor: isActing ? 'wait' : 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: isActing ? 0.6 : 1,
          }}>
            <X size={14} /> דחה
          </button>
          <button onClick={() => handleApprove(dep)} disabled={isActing} style={{
            flex: 1, padding: '10px 12px', borderRadius: 10,
            background: 'var(--good)', color: 'white',
            border: 'none', fontWeight: 600, fontSize: 13.5,
            cursor: isActing ? 'wait' : 'pointer', fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: '0 4px 14px -4px var(--good)',
            opacity: isActing ? 0.6 : 1,
          }}>
            <Check size={14} /> {isActing ? 'מעבד...' : 'אשר בקשה'}
          </button>
        </div>

        <button
          onClick={() => handleCancel(dep)}
          disabled={isActing}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--ink-faint)', fontSize: 12, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 4, marginTop: 8,
            padding: '4px 0',
          }}
        >
          <Trash2 size={12} /> ביטול בקשה
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>תור אישורים</div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>בקשות ממתינות</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="glass" style={{ height: 120, borderRadius: 20, animation: 'admin-pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>תור אישורים</div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>
            בקשות ממתינות
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5 }}>
            <span style={{ fontWeight: 600 }}>{pending.length}</span> בקשות ממתינות לאישור
            {urgentRequests.length > 0 && ` — ${urgentRequests.length} מהן חריגות`}.
          </p>
        </div>
        {urgentRequests.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertOctagon size={16} style={{ color: 'var(--bad)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bad)' }}>{urgentRequests.length} חריגות</span>
          </div>
        )}
      </div>

      {/* ── Urgent banner ─────────────────────────────────────────────── */}
      {urgentRequests.length > 0 && (
        <div className="glass" style={{
          padding: 16, display: 'flex', alignItems: 'center', gap: 14,
          background: `linear-gradient(90deg, var(--bad-soft) 0%, transparent 60%), var(--glass-2)`,
          borderInlineStart: '3px solid var(--bad)',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bad-soft)', color: 'var(--bad)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertOctagon size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{urgentRequests.length} בקשות חריגות ממתינות</div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>בקשות חריגות מסומנות בעדיפות — ממליצים לטפל קודם</div>
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {pending.length === 0 && (
        <div className="glass" style={{ padding: 60, textAlign: 'center' }}>
          <Check size={36} style={{ color: 'var(--good)', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>אין בקשות ממתינות</div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 6 }}>כל הבקשות טופלו. נחזור כשתגיע בקשה חדשה.</div>
        </div>
      )}

      {/* ── Urgent requests ───────────────────────────────────────────── */}
      {urgentRequests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 24, background: 'var(--bad)', borderRadius: 3 }} />
            <h3 style={{ fontSize: 17, fontWeight: 500, color: 'var(--bad)', margin: 0 }}>
              בקשות חריגות ({urgentRequests.length})
            </h3>
          </div>
          <div className="admin-request-grid">
            {urgentRequests.map((dep) => <RequestCard key={dep.id} dep={dep} />)}
          </div>
        </div>
      )}

      {/* ── Regular requests ──────────────────────────────────────────── */}
      {regularRequests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
          {urgentRequests.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 24, background: 'var(--info)', borderRadius: 3 }} />
              <h3 style={{ fontSize: 17, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                בקשות רגילות ({regularRequests.length})
              </h3>
            </div>
          )}
          <div className="admin-request-grid">
            {regularRequests.map((dep) => <RequestCard key={dep.id} dep={dep} />)}
          </div>
        </div>
      )}
    </div>
  )
}
