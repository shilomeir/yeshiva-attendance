import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { he } from 'date-fns/locale'
import { Check, X, Clock, User, AlertOctagon } from 'lucide-react'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { toast } from '@/hooks/use-toast'
import type { AbsenceRequest, Student } from '@/types'

interface RequestWithStudent extends AbsenceRequest {
  student: Student | undefined
}

export function PendingRequestsPage() {
  const [requests, setRequests] = useState<RequestWithStudent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [adminNote, setAdminNote] = useState<Record<string, string>>({})

  const loadRequests = async () => {
    setIsLoading(true)
    try {
      const pending = await api.getAbsenceRequests({ status: 'PENDING' })
      const students = await api.getStudents()
      const studentMap = new Map(students.map((s) => [s.id, s]))
      setRequests(pending.map((r) => ({ ...r, student: studentMap.get(r.studentId) })))
    } catch {
      console.error('Failed to load absence requests')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('pending-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_requests' }, () => {
        loadRequests()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleApprove = async (req: RequestWithStudent) => {
    try {
      await api.updateAbsenceRequestStatus(req.id, 'APPROVED', adminNote[req.id])
      toast({ title: 'הבקשה אושרה' })
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch {
      toast({ title: 'שגיאה באישור הבקשה', variant: 'destructive' })
    }
  }

  const handleReject = async (req: RequestWithStudent) => {
    try {
      await api.updateAbsenceRequestStatus(req.id, 'REJECTED', adminNote[req.id])
      toast({ title: 'הבקשה נדחתה' })
      setRequests((prev) => prev.filter((r) => r.id !== req.id))
    } catch {
      toast({ title: 'שגיאה בדחיית הבקשה', variant: 'destructive' })
    }
  }

  const urgentRequests = requests.filter((r) => r.isUrgent)
  const regularRequests = requests.filter((r) => !r.isUrgent)

  const RequestCard = ({ req }: { req: RequestWithStudent }) => (
    <Card key={req.id} className={req.isUrgent ? 'border-orange-300 dark:border-orange-700' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-2)]">
              <User className="h-4 w-4 text-[var(--text-muted)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--text)]">{req.student?.fullName ?? 'לא ידוע'}</p>
              <p className="text-xs text-[var(--text-muted)]">ת.ז. {req.student?.idNumber} · {req.student?.classId}</p>
            </div>
          </div>

          <div className="rounded-lg bg-[var(--bg-2)] p-3 text-sm">
            <p className="font-medium text-[var(--text)]">{req.reason}</p>
            <p className="mt-1 text-[var(--text-muted)]">
              {format(new Date(req.date), 'EEEE, d בMMMM yyyy', { locale: he })}
              {req.endDate && req.endDate !== req.date && ` — ${format(new Date(req.endDate), 'd בMMMM', { locale: he })}`}
            </p>
            <div className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
              <Clock className="h-3.5 w-3.5" />
              {req.startTime} — {req.endTime}
            </div>
          </div>

          <Input
            placeholder="הערה לתלמיד (אופציונלי)"
            value={adminNote[req.id] ?? ''}
            onChange={(e) => setAdminNote((prev) => ({ ...prev, [req.id]: e.target.value }))}
            className="text-sm"
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-[var(--red)] text-[var(--red)] hover:bg-red-50"
              onClick={() => handleReject(req)}
            >
              <X className="h-4 w-4" />
              דחייה
            </Button>
            <Button
              className="flex-1 bg-[var(--green)] hover:bg-green-600"
              onClick={() => handleApprove(req)}
            >
              <Check className="h-4 w-4" />
              אישור
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )

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
        <p className="text-sm text-[var(--text-muted)]">{requests.length} בקשות ממתינות לאישור</p>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-[var(--text-muted)]">
          <Check className="h-10 w-10 opacity-40" />
          <p>אין בקשות ממתינות</p>
        </div>
      ) : (
        <>
          {/* Urgent requests section */}
          {urgentRequests.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-[var(--orange)]" />
                <CardTitle className="text-base text-[var(--orange)]">בקשות חריגות ({urgentRequests.length})</CardTitle>
              </div>
              {urgentRequests.map((req) => <RequestCard key={req.id} req={req} />)}
            </div>
          )}

          {/* Regular requests section */}
          {regularRequests.length > 0 && (
            <div className="flex flex-col gap-3">
              <CardTitle className="text-base text-[var(--text)]">בקשות רגילות ({regularRequests.length})</CardTitle>
              {regularRequests.map((req) => <RequestCard key={req.id} req={req} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
