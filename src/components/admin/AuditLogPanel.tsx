import { useEffect, useState } from 'react'
import { ArrowRight, User, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { api } from '@/lib/api'
import { db } from '@/lib/db/schema'
import { formatDateTimeHebrew } from '@/lib/utils/formatTime'
import type { AdminOverride, Student } from '@/types'

const PAGE_SIZE = 20

interface OverrideWithStudent extends AdminOverride {
  student: Student | undefined
}

export function AuditLogPanel() {
  const [overrides, setOverrides] = useState<OverrideWithStudent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const all = await api.getAdminOverrides()
      setTotal(all.length)

      const students = await db.students.toArray()
      const studentMap = new Map(students.map((s) => [s.id, s]))

      const paged = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      setOverrides(paged.map((o) => ({ ...o, student: studentMap.get(o.studentId) })))
    } catch {
      console.error('Failed to load audit log')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="flex justify-center py-8 text-[var(--text-muted)]">טוען לוג...</div>
      ) : overrides.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-[var(--text-muted)]">
          <Shield className="h-10 w-10 opacity-40" />
          <p>אין פעולות ביקורת</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-2)]">
                <tr>
                  <th className="py-3 ps-4 text-start font-medium text-[var(--text-muted)]">תלמיד</th>
                  <th className="py-3 text-start font-medium text-[var(--text-muted)]">שינוי</th>
                  <th className="py-3 text-start font-medium text-[var(--text-muted)]">זמן</th>
                  <th className="py-3 pe-4 text-start font-medium text-[var(--text-muted)]">הערה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
                {overrides.map((override) => (
                  <tr key={override.id} className="hover:bg-[var(--bg-2)] transition-colors">
                    <td className="py-3 ps-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-2)]">
                          <User className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                        </div>
                        <span className="font-medium text-[var(--text)] truncate max-w-[120px]">
                          {override.student?.fullName ?? 'לא ידוע'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={override.previousStatus} />
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                        <StatusBadge status={override.newStatus} />
                      </div>
                    </td>
                    <td className="py-3 text-[var(--text-muted)] whitespace-nowrap">
                      {formatDateTimeHebrew(override.timestamp)}
                    </td>
                    <td className="py-3 pe-4 text-[var(--text-muted)] max-w-[150px] truncate">
                      {override.note ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--text-muted)]">
                עמוד {page + 1} מתוך {totalPages} ({total} רשומות)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  הקודם
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  הבא
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
