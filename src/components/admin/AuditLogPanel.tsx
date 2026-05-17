import { useEffect, useState } from 'react'
import { Check, X, RefreshCw, Edit2, Bell, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { AdminOverride, Student } from '@/types'

const PAGE_SIZE = 20

interface OverrideWithStudent extends AdminOverride {
  student: Student | undefined
}

interface AuditStats {
  today: number
  approvals: number
  rejections: number
  manual: number
}

function actionTone(action: string): 'good' | 'bad' | 'warn' | 'plum' | 'info' {
  if (action.includes('approve')) return 'good'
  if (action.includes('reject')) return 'bad'
  if (action.includes('cancel')) return 'warn'
  if (action === 'STATUS_OVERRIDE' || action === 'manual_override') return 'plum'
  return 'info'
}

function actionLabel(action: string): string {
  switch (action) {
    case 'approve_absence_request': return 'אישור בקשה'
    case 'reject_absence_request':  return 'דחיית בקשה'
    case 'cancel_absence_request':  return 'ביטול בקשה'
    case 'STATUS_OVERRIDE':
    case 'manual_override':         return 'עדכון ידני'
    default: return 'פעולה'
  }
}

const TONE_COLOR: Record<string, string> = {
  good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', plum: 'var(--plum)', info: 'var(--info)',
}
const TONE_SOFT: Record<string, string> = {
  good: 'var(--good-soft)', bad: 'var(--bad-soft)', warn: 'var(--warn-soft)', plum: 'var(--plum-soft)', info: 'var(--info-soft)',
}
const TONE_ICON: Record<string, React.ReactNode> = {
  good: <Check size={13} />, bad: <X size={13} />, warn: <RefreshCw size={13} />, plum: <Edit2 size={13} />, info: <Bell size={13} />,
}

export function AuditLogPanel() {
  const [overrides, setOverrides] = useState<OverrideWithStudent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<AuditStats>({ today: 0, approvals: 0, rejections: 0, manual: 0 })

  const loadData = async () => {
    setIsLoading(true)
    try {
      const all = await api.getAdminOverrides()
      setTotal(all.length)

      const now = Date.now()
      setStats({
        today:     all.filter(o => now - new Date(o.timestamp).getTime() < 86_400_000).length,
        approvals: all.filter(o => o.action.includes('approve')).length,
        rejections: all.filter(o => o.action.includes('reject')).length,
        manual:    all.filter(o => o.action === 'STATUS_OVERRIDE' || o.action === 'manual_override').length,
      })

      const students = await api.getStudents()
      const studentMap = new Map(students.map((s) => [s.id, s]))

      const paged = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      setOverrides(paged.map((o) => ({ ...o, student: studentMap.get(o.studentId) })))
    } catch (err) {
      toast({ title: 'שגיאה בטעינת לוג ביקורת', description: getErrorMessage(err, 'טעינת לוג הביקורת נכשלה'), variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadData() }, [page])

  useEffect(() => {
    const channel = supabase
      .channel('audit-log-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_overrides' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ── 4-stat strip ─────────────────────────────────────────────────────────

  const statItems = [
    { label: 'סה"כ היום',      val: stats.today,      color: 'var(--ink)' },
    { label: 'אישורים',         val: stats.approvals,  color: 'var(--good)' },
    { label: 'דחיות',           val: stats.rejections, color: 'var(--bad)' },
    { label: 'עדכונים ידניים',  val: stats.manual,     color: 'var(--plum)' },
  ]

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-sm)' }}>
        {[1, 2, 3].map(i => (
          <div key={i} className="glass" style={{ height: 72, borderRadius: 16, animation: 'admin-pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

      {/* ── Stat strip ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--gap-sm)' }}>
        {statItems.map((s, i) => (
          <div key={i} className="glass" style={{ padding: 'var(--card-pad)', borderInlineStart: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>{s.label}</div>
            <div className="font-mono-num" style={{ fontSize: 32, fontWeight: 600, color: s.color, letterSpacing: '-0.03em', marginTop: 4, lineHeight: 1 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* ── Timeline ──────────────────────────────────────────────────── */}
      {overrides.length === 0 ? (
        <div className="glass" style={{ padding: 60, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 14, background: 'var(--plum-soft)', color: 'var(--plum)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <Edit2 size={18} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>אין פעולות ביקורת</p>
          <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>פעולות מנהל יופיעו כאן</p>
        </div>
      ) : (
        <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--hairline)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>פעילות אחרונה</div>
            <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: '4px 0 0' }}>סדרת אירועים</h3>
          </div>

          <div style={{ padding: '12px 22px' }}>
            {overrides.map((override, i) => {
              const tone = actionTone(override.action)
              const toneColor = TONE_COLOR[tone]
              const toneSoft  = TONE_SOFT[tone]

              const ts = new Date(override.timestamp)
              const timeStr = ts.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
              const dateStr = ts.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
              const minsAgo = Math.floor((Date.now() - ts.getTime()) / 60000)
              const ago =
                minsAgo < 60 ? `לפני ${minsAgo} דק'` :
                minsAgo < 60 * 24 ? `לפני ${Math.floor(minsAgo / 60)} שע'` :
                `לפני ${Math.floor(minsAgo / (60 * 24))} ימים`

              return (
                <div
                  key={override.id}
                  style={{
                    display: 'flex', gap: 16, padding: '14px 0',
                    borderBottom: i === overrides.length - 1 ? 'none' : '1px solid var(--hairline)',
                  }}
                >
                  {/* Colored icon badge */}
                  <div style={{ flexShrink: 0, paddingTop: 2 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 10,
                      background: toneSoft, color: toneColor,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${toneColor}33`,
                    }}>
                      {TONE_ICON[tone]}
                    </div>
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: toneColor }}>{actionLabel(override.action)}</span>
                      <span style={{ fontSize: 13, color: 'var(--ink)' }}>· {override.student?.fullName ?? 'לא ידוע'}</span>
                      {override.student?.classId && (
                        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>({override.student.classId})</span>
                      )}
                    </div>
                    {override.note && (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4, fontStyle: 'italic' }}>"{override.note}"</div>
                    )}
                    <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11.5, color: 'var(--ink-faint)' }}>
                      <span className="font-mono-num">{dateStr} · {timeStr}</span>
                      <span>· {ago}</span>
                    </div>
                  </div>

                  <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 6, borderRadius: 8, alignSelf: 'flex-start' }}>
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                עמוד {page + 1} מתוך {totalPages} ({total} רשומות)
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  הקודם
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                  הבא
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
