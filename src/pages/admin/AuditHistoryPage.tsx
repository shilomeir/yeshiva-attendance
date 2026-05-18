import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, ChevronLeft, ClipboardList, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { AuditSessionSummary, AuditSessionStatus } from '@/types'

const PAGE_SIZE = 20

function statusLabel(s: AuditSessionStatus) {
  if (s === 'ACTIVE') return 'פעילה'
  if (s === 'CLOSED') return 'סגורה'
  if (s === 'TIMED_OUT') return 'פג תוקף'
  return 'בוטלה'
}

function statusBadgeClass(s: AuditSessionStatus) {
  if (s === 'ACTIVE')
    return 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
  if (s === 'CLOSED')
    return 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700'
  return 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/40 dark:text-gray-300 dark:border-gray-600'
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} שניות`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} דקות`
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} שעות`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function sessionTitle(s: AuditSessionSummary): string {
  if (s.title) return s.title
  return `ביקורת ${formatDate(s.startedAt)} ${formatTime(s.startedAt)}`
}

export function AuditHistoryPage() {
  const [sessions, setSessions] = useState<AuditSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const load = async (offset: number) => {
    try {
      const rows = await api.listAuditSessions(PAGE_SIZE, offset)
      setHasMore(rows.length === PAGE_SIZE)
      return rows
    } catch (err) {
      toast({
        title: 'שגיאה בטעינת ההיסטוריה',
        description: getErrorMessage(err, 'טעינת רשימת הביקורות נכשלה'),
        variant: 'destructive',
      })
      return []
    }
  }

  useEffect(() => {
    load(0).then((rows) => {
      setSessions(rows)
      setLoading(false)
    })
  }, [])

  const handleLoadMore = async () => {
    setLoadingMore(true)
    const rows = await load(sessions.length)
    setSessions((prev) => [...prev, ...rows])
    setLoadingMore(false)
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-[var(--text)]">היסטוריית ביקורות</h2>
        <p className="text-sm text-[var(--text-muted)]">
          רשימת כל הביקורות הפנימיות שבוצעו, עם מספרי סיכום וייצוא ל־CSV
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--blue)]" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-16 text-center">
          <ClipboardList className="h-10 w-10 text-[var(--text-muted)] opacity-40" />
          <p className="font-medium text-[var(--text-muted)]">לא בוצעו ביקורות עדיין</p>
          <p className="text-sm text-[var(--text-muted)]">
            פתח ביקורת מהדף "ביקורת פנימית" כדי להתחיל
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {sessions.map((s) => {
              const pct = s.totalStudentsSnapshot > 0
                ? Math.round((s.markedCount / s.totalStudentsSnapshot) * 100)
                : 0
              return (
                <Link
                  key={s.id}
                  to={`/admin/audits/${s.id}`}
                  className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--blue)] hover:shadow-md transition-all flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--text)] truncate group-hover:text-[var(--blue)]">
                        {sessionTitle(s)}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-muted)] mt-1">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(s.startedAt)} {formatTime(s.startedAt)}
                          {s.closedAt && ` → ${formatTime(s.closedAt)}`}
                        </span>
                        <span>·</span>
                        <span>{formatDuration(s.durationSec)}</span>
                        <span>·</span>
                        <span>{s.classIds.length} כיתות · {s.totalStudentsSnapshot} תלמידים</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeClass(s.status)}`}
                      >
                        {statusLabel(s.status)}
                      </span>
                      <ChevronLeft className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--blue)]" />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="inline-flex items-center gap-1 rounded-md bg-green-50 dark:bg-green-950/30 px-2 py-1 text-xs text-green-700 dark:text-green-400">
                      <span className="font-bold">{s.inYeshivaCount}</span> בישיבה
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950/30 px-2 py-1 text-xs text-blue-700 dark:text-blue-400">
                      <span className="font-bold">{s.outWithPermCount}</span> ביצ׳ רשות
                    </span>
                    {s.outWithoutPermCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs text-red-700 dark:text-red-400 font-bold">
                        {s.outWithoutPermCount} ביצ׳ ללא רשות
                      </span>
                    )}
                    {s.unmarkedCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                        <span className="font-bold">{s.unmarkedCount}</span> לא סומן
                      </span>
                    )}
                    <span className="text-xs text-[var(--text-muted)] ms-auto">{pct}% סומנו</span>
                  </div>
                </Link>
              )
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore} size="sm">
                {loadingMore ? 'טוען...' : 'טען עוד'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
