import { useState } from 'react'
import { Edit2, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { StatusOverrideModal } from '@/components/admin/StatusOverrideModal'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { useStudentsStore } from '@/store/studentsStore'
import type { Student } from '@/types'

interface StudentRowProps {
  student: Student
  onUpdate: () => void
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`
  }
  return name.substring(0, 2)
}

function getAvatarColor(id: string): string {
  const colors = [
    'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
    'bg-red-500', 'bg-indigo-500', 'bg-teal-500', 'bg-pink-500',
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return colors[Math.abs(hash) % colors.length]
}

export function StudentRow({ student, onUpdate }: StudentRowProps) {
  const [showOverride, setShowOverride] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { deleteStudent } = useStudentsStore()

  const handleDelete = async () => {
    await deleteStudent(student.id)
    onUpdate()
  }

  return (
    <>
      <div
        className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 hover:bg-[var(--bg-2)] transition-colors"
        style={{ height: '72px' }}
      >
        {/* Avatar */}
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${getAvatarColor(student.id)}`}
        >
          {getInitials(student.fullName)}
        </div>

        {/* Info */}
        <div className="flex flex-1 min-w-0 flex-col justify-center gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[var(--text)]">{student.fullName}</span>
            {student.pendingApproval && (
              <span className="shrink-0 rounded-full bg-[var(--orange)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                חדש
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            ת.ז. {student.idNumber} · {formatRelativeTime(student.lastSeen)}
          </span>
        </div>

        {/* Status badge */}
        <StatusBadge status={student.currentStatus} className="shrink-0 hidden sm:flex" />

        {/* Edit status */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowOverride(true)}
          className="shrink-0 h-8 w-8 text-[var(--text-muted)]"
          title="עדכון סטטוס"
        >
          <Edit2 className="h-4 w-4" />
        </Button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={handleDelete}
              className="rounded px-2 py-1 text-xs font-medium text-white bg-[var(--red)] hover:opacity-90 transition-opacity"
            >
              מחק
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-2)]"
            >
              ביטול
            </button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 h-8 w-8 text-[var(--text-muted)] hover:text-[var(--red)]"
            title="מחיקת תלמיד"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <StatusOverrideModal
        student={student}
        open={showOverride}
        onClose={() => setShowOverride(false)}
        onSuccess={onUpdate}
      />
    </>
  )
}
