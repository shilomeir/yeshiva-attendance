import { useEffect, useMemo, useState } from 'react'
import { MapPin, Users, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { auditApi } from '../api/auditApi'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { ClassStat } from '@/types'

interface AuditStartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (sessionId: string) => void
}

export function AuditStartDialog({ open, onOpenChange, onStarted }: AuditStartDialogProps) {
  const [mode, setMode] = useState<'LOCATION' | 'MANUAL' | null>(null)
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode(null)
    api.getClassStats().then((stats) => {
      setClassStats(stats)
      setSelected(new Set(stats.map((s) => s.classId)))
    }).catch((err) => {
      toast({
        title: 'שגיאה בטעינת כיתות',
        description: getErrorMessage(err, 'טעינת רשימת הכיתות נכשלה'),
        variant: 'destructive',
      })
    })
  }, [open])

  const totalStudents = useMemo(
    () => classStats.filter((s) => selected.has(s.classId)).reduce((sum, s) => sum + s.total, 0),
    [classStats, selected],
  )

  const toggleClass = (classId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(classStats.map((s) => s.classId)))
  const clearAll = () => setSelected(new Set())

  const handleStart = async () => {
    if (!mode || selected.size === 0) return
    setBusy(true)
    try {
      const created = await auditApi.createSession({
        mode,
        classIds: [...selected],
        title: mode === 'LOCATION' ? 'ביקורת פנימית — מיקום' : 'ביקורת פנימית — ידנית',
      })
      await auditApi.activateSession(created.sessionId)
      if (mode === 'LOCATION') {
        // Best-effort push — failures here shouldn't block the session
        auditApi.dispatchPush(created.sessionId).catch(() => {})
      }
      toast({
        title: 'הביקורת הופעלה',
        description: `${created.participants} תלמידים ב-${created.classes} כיתות`,
      })
      onStarted(created.sessionId)
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'שגיאה בהפעלת ביקורת',
        description: getErrorMessage(err, 'יצירת סשן הביקורת נכשלה'),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>הפעלת ביקורת פנימית</DialogTitle>
          <DialogDescription>בחר אופן ביקורת וכיתות משתתפות</DialogDescription>
        </DialogHeader>

        {/* Mode selection */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <ModeCard
            icon={<MapPin size={20} />}
            label="ביקורת עם מיקום"
            desc="שולח התראה לתלמידים, אוסף GPS אוטומטית"
            active={mode === 'LOCATION'}
            onClick={() => setMode('LOCATION')}
          />
          <ModeCard
            icon={<ClipboardList size={20} />}
            label="ביקורת ידנית"
            desc="כל רכז מסמן את תלמידי כיתתו"
            active={mode === 'MANUAL'}
            onClick={() => setMode('MANUAL')}
          />
        </div>

        {/* Class selection */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>כיתות משתתפות</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={selectAll}  style={chipBtn}>הכל</button>
              <button onClick={clearAll}   style={chipBtn}>ניקוי</button>
            </div>
          </div>
          <div style={{
            maxHeight: 220, overflowY: 'auto',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
            border: '1px solid var(--hairline)', borderRadius: 12, padding: 8,
          }}>
            {classStats.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: 16, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 12 }}>
                טוען...
              </div>
            )}
            {classStats.map((c) => {
              const on = selected.has(c.classId)
              return (
                <button
                  key={c.classId}
                  onClick={() => toggleClass(c.classId)}
                  style={{
                    textAlign: 'right', padding: '8px 10px',
                    borderRadius: 8, fontFamily: 'inherit',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--hairline)'}`,
                    background: on ? 'var(--accent-soft)' : 'rgba(255,255,255,0.65)',
                    color: 'var(--ink)', cursor: 'pointer',
                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <input type="checkbox" checked={on} readOnly style={{ pointerEvents: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.15 }}>
                      {c.classId.replace(/^כיתה\s+/, '')}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{c.total} תלמידים</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Pre-flight summary */}
        <div style={{
          marginTop: 14, display: 'flex', gap: 14,
          padding: '10px 12px', borderRadius: 10,
          background: 'var(--accent-soft)',
          fontSize: 12.5, color: 'var(--ink-muted)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Users size={13} /> {totalStudents} תלמידים
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ClipboardList size={13} /> {selected.size} כיתות
          </span>
        </div>

        <DialogFooter style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>ביטול</Button>
          <Button
            onClick={handleStart}
            disabled={busy || !mode || selected.size === 0}
          >
            {busy ? 'מפעיל...' : 'התחל ביקורת'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({ icon, label, desc, active, onClick }: {
  icon: React.ReactNode; label: string; desc: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'right', padding: '14px 14px',
        borderRadius: 12, cursor: 'pointer',
        background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.65)',
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--hairline)'}`,
        color: 'var(--ink)', fontFamily: 'inherit',
      }}
    >
      <div style={{ color: active ? 'var(--accent)' : 'var(--ink-muted)' }}>{icon}</div>
      <div style={{ marginTop: 6, fontWeight: 600, fontSize: 13.5 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 4 }}>{desc}</div>
    </button>
  )
}

const chipBtn: React.CSSProperties = {
  padding: '3px 9px', borderRadius: 999, fontFamily: 'inherit',
  background: 'rgba(255,255,255,0.6)', border: '1px solid var(--hairline)',
  fontSize: 11.5, color: 'var(--ink-muted)', cursor: 'pointer',
}
