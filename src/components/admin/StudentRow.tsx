import { useState } from 'react'
import { Edit2, Trash2, GraduationCap } from 'lucide-react'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { StatusOverrideModal } from '@/components/admin/StatusOverrideModal'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { useStudentsStore } from '@/store/studentsStore'
import { api } from '@/lib/api'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
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

// ── Class Edit Modal ──────────────────────────────────────────────────────────

function ClassEditModal({
  student,
  onClose,
  onSaved,
}: {
  student: Student
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedGrade, setSelectedGrade] = useState(student.grade)
  const [selectedClass, setSelectedClass] = useState(student.classId)
  const [saving, setSaving] = useState(false)

  const classOptions = getClasses(selectedGrade)

  const handleGradeChange = (newGrade: string) => {
    setSelectedGrade(newGrade)
    setSelectedClass(getClasses(newGrade)[0])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateStudentGrade(student.id, selectedGrade, selectedClass)
      onSaved()
      onClose()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-[var(--surface)] p-5 shadow-xl">
        <h3 className="mb-4 text-base font-bold text-[var(--text)]">
          עריכת כיתה — {student.fullName}
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שכבה</label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              dir="rtl"
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>
          {classOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">כיתה</label>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                dir="rtl"
              >
                {classOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Student Row ───────────────────────────────────────────────────────────────

export function StudentRow({ student, onUpdate }: StudentRowProps) {
  const [showOverride, setShowOverride] = useState(false)
  const [showClassEdit, setShowClassEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { deleteStudent, refreshStudent } = useStudentsStore()

  const handleDelete = async () => {
    await deleteStudent(student.id)
    onUpdate()
  }

  const handleClassSaved = async () => {
    await refreshStudent(student.id)
    onUpdate()
  }

  const classLabel = student.classId?.includes('כיתה')
    ? `כיתה ${student.classId.split('כיתה ')[1]}`
    : student.classId ?? ''

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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate font-medium text-[var(--text)]">{student.fullName}</span>
            {student.pendingApproval && (
              <span className="shrink-0 rounded-full bg-[var(--orange)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                חדש
              </span>
            )}
            {classLabel && (
              <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {classLabel}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            ת.ז. {student.idNumber} · {formatRelativeTime(student.lastSeen)}
          </span>
        </div>

        {/* Status badge */}
        <StatusBadge status={student.currentStatus} className="shrink-0 hidden sm:flex" />

        {/* Edit class */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowClassEdit(true)}
          className="shrink-0 h-8 w-8 text-[var(--text-muted)]"
          title="עריכת כיתה"
        >
          <GraduationCap className="h-4 w-4" />
        </Button>

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

      {showClassEdit && (
        <ClassEditModal
          student={student}
          onClose={() => setShowClassEdit(false)}
          onSaved={handleClassSaved}
        />
      )}
    </>
  )
}
