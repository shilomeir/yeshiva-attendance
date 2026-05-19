import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { useStudentsStore } from '@/store/studentsStore'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Student } from '@/types'

interface StudentRowProps {
  student: Student
  onUpdate: () => void
  onEditClass: (student: Student) => void
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ')
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`
  return name.substring(0, 2)
}

function getAvatarHue(id: string): string {
  const hues = [220, 270, 150, 30, 0, 200, 170, 320]
  let hash = 0
  for (let i = 0; i < id.length; i++) { hash = (hash << 5) - hash + id.charCodeAt(i); hash |= 0 }
  const hue = hues[Math.abs(hash) % hues.length]
  return `hsl(${hue} 55% 40%)`
}

export function StudentRow({ student, onUpdate, onEditClass }: StudentRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { deleteStudent } = useStudentsStore()

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteStudent(student.id)
      onUpdate()
    } catch (err) {
      toast({ title: 'שגיאה במחיקה', description: getErrorMessage(err, 'מחיקת התלמיד נכשלה'), variant: 'destructive' })
      setConfirmDelete(false)
    } finally {
      setDeleting(false) }
  }

  const classLabel = student.classId?.replace(/^כיתה\s+/, '') ?? ''
  const avatarColor = getAvatarHue(student.id)

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        height: 72, padding: '0 16px',
        borderBottom: '1px solid var(--hairline)',
        background: 'transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.35)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: `${avatarColor}22`,
        border: `1.5px solid ${avatarColor}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: avatarColor,
      }}>
        {getInitials(student.fullName)}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {student.fullName}
          </span>
          {student.pendingApproval && (
            <span style={{ borderRadius: 999, background: 'var(--warn-soft)', color: 'var(--warn)', padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>
              חדש
            </span>
          )}
          {classLabel && (
            <span style={{ borderRadius: 999, border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.5)', padding: '1px 7px', fontSize: 10.5, color: 'var(--ink-faint)' }}>
              {classLabel}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          ת.ז. {student.idNumber} · {formatRelativeTime(student.lastSeen)}
        </span>
      </div>

      {/* Status badge */}
      <StatusBadge status={student.currentStatus} className="shrink-0 hidden sm:flex" />

      {/* Edit */}
      <button
        onClick={() => onEditClass(student)}
        title="עריכת פרטי תלמיד"
        style={{
          flexShrink: 0, width: 30, height: 30, borderRadius: 8,
          border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.6)',
          color: 'var(--ink-faint)', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-faint)')}
      >
        <Pencil size={13} />
      </button>

      {/* Delete */}
      {confirmDelete ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--bad)', lineHeight: 1.2 }}>מחיקה תמחק את כל ההיסטוריה</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 600,
                color: '#fff', background: 'var(--bad)', border: 'none', cursor: 'pointer',
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? '...' : 'מחק'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{
                borderRadius: 6, padding: '3px 10px', fontSize: 11.5, fontWeight: 600,
                color: 'var(--ink-muted)', background: 'rgba(255,255,255,0.6)',
                border: '1px solid var(--hairline)', cursor: 'pointer',
              }}
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          title="מחיקת תלמיד"
          style={{
            flexShrink: 0, width: 30, height: 30, borderRadius: 8,
            border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.6)',
            color: 'var(--ink-faint)', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--bad)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-faint)')}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
