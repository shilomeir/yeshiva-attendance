import { useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { GRADE_LEVELS, GRADE_CLASS_MAP } from '@/lib/constants/grades'
import type { Student } from '@/types'

interface EditStudentModalProps {
  student: Student
  onClose: () => void
  onSaved: () => void
}

export function EditStudentModal({ student, onClose, onSaved }: EditStudentModalProps) {
  const [fullName, setFullName] = useState(student.fullName)
  const [phone, setPhone] = useState(student.phone)
  const [grade, setGrade] = useState(student.grade)
  const [classId, setClassId] = useState(student.classId)
  const [saving, setSaving] = useState(false)

  const classOptions = GRADE_CLASS_MAP[grade] ?? []

  const handleGradeChange = (newGrade: string) => {
    setGrade(newGrade)
    setClassId(GRADE_CLASS_MAP[newGrade]?.[0] ?? '')
  }

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error('יש למלא שם מלא')
      return
    }
    setSaving(true)
    try {
      const result = await api.updateStudent(student.id, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        grade,
        classId,
      })
      if (result.error) {
        toast.error(result.error.message)
        return
      }
      toast.success('פרטי התלמיד עודכנו')
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-t-2xl bg-[var(--surface)] p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--text)]">עריכת תלמיד — {student.fullName}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-2)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3" dir="rtl">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שם מלא</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">מספר זהות</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text-muted)] bg-[var(--bg-2)] cursor-not-allowed"
              value={student.idNumber} readOnly disabled
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">טלפון</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={phone} onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שיעור</label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={grade} onChange={(e) => handleGradeChange(e.target.value)}
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
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                value={classId} onChange={(e) => setClassId(e.target.value)}
              >
                {classOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-1 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>ביטול</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
