import { useEffect, useState } from 'react'
import { MapPin, History, Tv } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import { auditApi } from '../api/auditApi'
import { useActiveAuditSession } from '../hooks/useActiveAuditSession'
import { useAuditDashboardData } from '../hooks/useAuditDashboardData'
import { AuditStartDialog } from '../components/AuditStartDialog'
import { AuditCommandHeader } from '../components/AuditCommandHeader'
import { AuditMetricStrip } from '../components/AuditMetricStrip'
import { AuditClassMatrix } from '../components/AuditClassMatrix'
import { AuditStudentTable } from '../components/AuditStudentTable'
import { AuditAlertStack } from '../components/AuditAlertStack'
import { AuditLiveFeed } from '../components/AuditLiveFeed'
import { AuditSummaryPanel } from '../components/AuditSummaryPanel'
import { useAuthStore } from '@/store/authStore'
import type { AuditSession } from '../api/auditTypes'

/**
 * Replacement for the old RollCallPage. Persistent, refresh-safe,
 * DB-driven. Renders one of four screens depending on session state:
 *   - no session         → start screen
 *   - DRAFT / ACTIVE     → live dashboard
 *   - CLOSING            → finalising (transient)
 *   - COMPLETED          → summary card (until admin clicks "return")
 */
export function InternalAuditPage() {
  const { session, isLoading, refresh } = useActiveAuditSession()
  const [showSummaryFor, setShowSummaryFor] = useState<AuditSession | null>(null)
  const [showStart, setShowStart] = useState(false)
  const [busyAction, setBusyAction] = useState(false)

  // If session disappears (admin completed/cancelled), clear summary view too
  useEffect(() => {
    if (session && session.status !== 'COMPLETED') {
      setShowSummaryFor(null)
    }
  }, [session?.id, session?.status])

  if (isLoading) {
    return (
      <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-faint)' }}>
        טוען מצב ביקורת...
      </div>
    )
  }

  // Last-completed summary, persistent across reloads as long as admin doesn't dismiss
  if (showSummaryFor) {
    return (
      <AuditSummaryPanel
        session={showSummaryFor}
        onReturnHome={() => setShowSummaryFor(null)}
      />
    )
  }

  // No live session — show start screen
  if (!session) {
    return (
      <>
        <StartScreen onStart={() => setShowStart(true)} />
        <AuditStartDialog
          open={showStart}
          onOpenChange={setShowStart}
          onStarted={() => refresh()}
        />
      </>
    )
  }

  return (
    <ActiveSessionView
      session={session}
      busy={busyAction}
      onComplete={async () => {
        setBusyAction(true)
        try {
          await auditApi.completeSession(session.id)
          const finalSession = await auditApi.getSession(session.id)
          if (finalSession) setShowSummaryFor(finalSession)
          toast({ title: 'הביקורת נסגרה', description: 'הדוח נשמר בהיסטוריה' })
        } catch (err) {
          toast({
            title: 'שגיאה בסגירת ביקורת',
            description: getErrorMessage(err, 'סגירת הביקורת נכשלה'),
            variant: 'destructive',
          })
        } finally {
          setBusyAction(false)
        }
      }}
      onCancel={async () => {
        if (!confirm('לבטל את הביקורת ללא שמירת דוח?')) return
        setBusyAction(true)
        try {
          await auditApi.cancelSession(session.id)
          toast({ title: 'הביקורת בוטלה' })
        } catch (err) {
          toast({
            title: 'שגיאה בביטול',
            description: getErrorMessage(err, 'ביטול הביקורת נכשל'),
            variant: 'destructive',
          })
        } finally {
          setBusyAction(false)
        }
      }}
    />
  )
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6,
          }}>
            מצב המתנה
          </div>
          <h1 style={{
            fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1,
            letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0,
          }}>
            ביקורת פנימית
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5, maxWidth: 580 }}>
            פותח חדר־מצב חי לסשן ביקורת. תלמידים מקבלים התראה, מיקומים נכנסים בלייב,
            רכזי כיתה משלימים פערים, וכל הביקורת נשמרת לדוח עבר.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" asChild>
            <Link to="/admin/rollcall/history">
              <History size={14} />
              ביקורות קודמות
            </Link>
          </Button>
          <Button onClick={onStart}>
            <MapPin size={14} />
            הפעל ביקורת
          </Button>
        </div>
      </div>

      <div
        className="glass"
        style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '64px 32px', textAlign: 'center',
          position: 'relative', overflow: 'hidden', minHeight: 420,
          background: 'radial-gradient(120% 80% at 50% 0%, var(--accent-soft) 0%, transparent 55%), var(--glass-2)',
        }}
      >
        <div style={{
          width: 80, height: 80, borderRadius: 24,
          background: 'linear-gradient(135deg, var(--ink), var(--accent))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', marginBottom: 22,
          boxShadow: '0 14px 36px -10px rgba(79,70,229,0.5)',
        }}>
          <MapPin size={32} />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 500, fontFamily: 'Fraunces, serif', color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          אין ביקורת פעילה
        </h2>
        <p style={{ marginTop: 8, fontSize: 13.5, color: 'var(--ink-muted)', maxWidth: 480, lineHeight: 1.6 }}>
          לחץ "הפעל ביקורת" כדי לפתוח דיאלוג עם בחירת מצב (עם מיקום / ידני) וכיתות.
          הסשן יישמר במסד הנתונים — רענון לא יאבד את הביקורת.
        </p>
      </div>
    </div>
  )
}

function ActiveSessionView({
  session, onComplete, onCancel, busy,
}: {
  session: AuditSession
  onComplete: () => void
  onCancel: () => void
  busy: boolean
}) {
  const { rows, alerts, metrics, classRows, isLoading } = useAuditDashboardData(session.id)
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const { isAdmin } = useAuthStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <AuditCommandHeader
        session={session}
        onComplete={onComplete}
        onCancel={onCancel}
        busy={busy}
      />

      <AuditMetricStrip metrics={metrics} />

      <AuditAlertStack alerts={alerts} rows={rows} />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
        gap: 12,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <AuditClassMatrix
            classRows={classRows}
            selectedClassId={classFilter}
            onSelect={setClassFilter}
          />
          <AuditStudentTable
            rows={rows}
            showLocation={isAdmin}
            classFilter={classFilter}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <AuditLiveFeed rows={rows} />
        </div>
      </div>

      {isLoading && rows.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-faint)' }}>
          טוען נתוני סשן...
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/admin/rollcall/${session.id}/projection`}>
            <Tv size={14} />
            פתח במסך הקרנה
          </Link>
        </Button>
      </div>
    </div>
  )
}
