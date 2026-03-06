import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
import type { Student } from '@/types'

interface ClassEditModalProps {
  student: Student
  onClose: () => void
  onSaved: () => void
}

export function ClassEditModal({ student, onClose, onSaved }: ClassEditModalProps) {
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
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Bottom sheet on mobile, centered modal on desktop */}
      <div className="w-full max-w-sm rounded-t-2xl bg-[var(--surface)] p-5 shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--text)]">
            עריכת כיתה — {student.fullName}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-2)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Grade select */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שכבה</label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              dir="rtl"
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Class select (only if grade has multiple classes) */}
          {classOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">כיתה</label>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
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
