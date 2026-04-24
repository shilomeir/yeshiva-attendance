import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { Check, X, Clock, User, AlertOctagon, Trash2, Users } from 'lucide-react'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { toast } from '@/hooks/use-toast'
import type { CalendarDeparture } from '@/types'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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

      // Build class → active departures map for quota-full context
      const byClass: Record<string, CalendarDeparture[]> = {}
      for (const d of activeDeps) {
        if (!byClass[d.class_id]) byClass[d.class_id] = []
        byClass[d.class_id].push(d)
      }
      setActiveByClass(byClass)
    } catch {
      console.error('Failed to load pending departures')
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
        toast({ title: failMsg, description: (result as { error: string }).error, variant: 'destructive' })
      } else {
        toast({ title: successMsg })
        // Realtime subscription will remove the card
      }
    } catch {
      toast({ title: failMsg, variant: 'destructive' })
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

    return (
      <Card className={dep.is_urgent ? 'border-orange-300 dark:border-orange-700' : ''}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            {/* Student info */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-2)]">
                <User className="h-4 w-4 text-[var(--text-muted)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--text)]">{dep.student_name}</p>
                <p className="text-xs text-[var(--text-muted)]">{dep.grade} · {dep.class_id}</p>
              </div>
              {dep.is_urgent && (
                <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-600 dark:bg-orange-900/30">
                  <AlertOctagon className="h-3 w-3" />
                  חריגה
                </span>
              )}
            </div>

            {/* Request details */}
            <div className="rounded-lg bg-[var(--bg-2)] p-3 text-sm">
              {dep.reason && <p className="font-medium text-[var(--text)]">{dep.reason}</p>}
              <p className="mt-1 text-[var(--text-muted)]">
                {format(new Date(dep.start_at), 'EEEE, d בMMMM yyyy', { locale: he })}
                {(() => {
                  const startDate = new Date(dep.start_at).toISOString().slice(0, 10)
                  const endDate = new Date(dep.end_at).toISOString().slice(0, 10)
                  if (endDate !== startDate) return ` — ${format(new Date(dep.end_at), 'd בMMMM', { locale: he })}`
                  return null
                })()}
              </p>
              <div className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
                <Clock className="h-3.5 w-3.5" />
                {getTimeStr(dep.start_at)} — {getTimeStr(dep.end_at)}
              </div>
            </div>

            {/* Quota context for non-urgent PENDING: show who's currently out from same class */}
            {!dep.is_urgent && classActive.length > 0 && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Users className="h-3.5 w-3.5 text-orange-600" />
                  <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                    כרגע מחוץ לישיבה מאותה כיתה:
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {classActive.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-xs text-orange-700 dark:text-orange-400">
                      <span>{d.student_name}</span>
                      <span className="text-orange-500">חזרה {getTimeStr(d.end_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin note */}
            <Input
              placeholder="הערה לתלמיד (אופציונלי)"
              value={adminNote[dep.id] ?? ''}
              onChange={(e) => setAdminNote((prev) => ({ ...prev, [dep.id]: e.target.value }))}
              className="text-sm"
              disabled={isActing}
            />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-[var(--red)] text-[var(--red)] hover:bg-red-50"
                onClick={() => handleReject(dep)}
                disabled={isActing}
              >
                <X className="h-4 w-4" />
                דחייה
              </Button>
              <Button
                className="flex-1 bg-[var(--green)] hover:bg-green-600"
                onClick={() => handleApprove(dep)}
                disabled={isActing}
              >
                <Check className="h-4 w-4" />
                {isActing ? 'מעבד...' : 'אישור'}
              </Button>
            </div>

            <button
              onClick={() => handleCancel(dep)}
              disabled={isActing}
              className="flex items-center gap-1 self-end rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-red-50 hover:text-[var(--red)] transition-colors dark:hover:bg-red-950/20 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              ביטול בקשה
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8 text-[var(--text-muted)]">
        <p>טוען בקשות...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">בקשות ממתינות</h2>
        <p className="text-sm text-[var(--text-muted)]">{pending.length} בקשות ממתינות לאישור</p>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-[var(--text-muted)]">
          <Check className="h-10 w-10 opacity-40" />
          <p>אין בקשות ממתינות</p>
        </div>
      ) : (
        <>
          {urgentRequests.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-[var(--orange)]" />
                <CardTitle className="text-base text-[var(--orange)]">
                  בקשות חריגות ({urgentRequests.length})
                </CardTitle>
              </div>
              {urgentRequests.map((dep) => <RequestCard key={dep.id} dep={dep} />)}
            </div>
          )}

          {regularRequests.length > 0 && (
            <div className="flex flex-col gap-3">
              <CardTitle className="text-base text-[var(--text)]">
                בקשות רגילות ({regularRequests.length})
              </CardTitle>
              {regularRequests.map((dep) => <RequestCard key={dep.id} dep={dep} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
