import { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
import { normalizeHebrew } from '@/store/studentsStore'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Student, StudentStatus } from '@/types'

interface StudentEditModalProps {
  student: Student
  onClose: () => void
  onSaved: () => void
}

const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: 'ON_CAMPUS', label: 'בישיבה' },
  { value: 'OFF_CAMPUS', label: 'מחוץ לישיבה' },
]

function resolveGrade(rawGrade: string | null | undefined): string {
  const normalized = normalizeHebrew(rawGrade ?? '')
  return GRADE_LEVELS.find((g) => normalizeHebrew(g.name) === normalized)?.name ?? GRADE_LEVELS[0].name
}

function resolveClass(grade: string, rawClass: string | null | undefined): string {
  const options = getClasses(grade)
  const normalized = normalizeHebrew(rawClass ?? '')
  return options.find((c) => normalizeHebrew(c) === normalized) ?? options[0] ?? ''
}

export function StudentEditModal({ student, onClose, onSaved }: StudentEditModalProps) {
  const [fullName, setFullName] = useState(student.fullName)
  const [phone, setPhone] = useState(student.phone ?? '')

  const initialGrade = resolveGrade(student.grade)
  const initialClass = resolveClass(initialGrade, student.classId)
  const [selectedGrade, setSelectedGrade] = useState(initialGrade)
  const [selectedClass, setSelectedClass] = useState(initialClass)

  const [showStatusSection, setShowStatusSection] = useState(false)
  const [overrideStatus, setOverrideStatus] = useState<StudentStatus>(student.currentStatus === 'OVERDUE' ? 'OFF_CAMPUS' : student.currentStatus as StudentStatus)
  const [overrideNote, setOverrideNote] = useState('')

  const [saving, setSaving] = useState(false)

  const classOptions = getClasses(selectedGrade)

  const handleGradeChange = (newGrade: string) => {
    setSelectedGrade(newGrade)
    setSelectedClass(getClasses(newGrade)[0] ?? '')
  }

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast({ title: 'שגיאה', description: 'שם מלא הוא שדה חובה', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const nameOrPhoneChanged =
        fullName.trim() !== student.fullName || phone.trim() !== (student.phone ?? '')
      const classChanged =
        normalizeHebrew(selectedGrade) !== normalizeHebrew(student.grade ?? '') ||
        normalizeHebrew(selectedClass) !== normalizeHebrew(student.classId ?? '')

      const effectiveStatus: StudentStatus =
        student.currentStatus === 'OVERDUE' ? 'OFF_CAMPUS' : student.currentStatus as StudentStatus
      const statusChanged = showStatusSection && overrideStatus !== effectiveStatus

      if (nameOrPhoneChanged) {
        const result = await api.updateStudent(student.id, {
          fullName: fullName.trim(),
          phone: phone.trim(),
        })
        if (result.error) {
          toast({ title: 'שגיאה בשמירה', description: result.error.message, variant: 'destructive' })
          return
        }
      }

      if (classChanged) {
        await api.updateStudentGrade(student.id, selectedGrade, selectedClass)
      }

      if (statusChanged) {
        await api.createAdminOverride(student.id, overrideStatus, overrideNote || undefined)
      }

      toast({ title: 'פרטי התלמיד עודכנו בהצלחה' })
      onSaved()
      onClose()
    } catch (err) {
      toast({
        title: 'שגיאה בשמירה',
        description: getErrorMessage(err, 'שמירת פרטי התלמיד נכשלה'),
        variant: 'destructive',
      })
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
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--text)]">
            עריכת תלמיד — {student.fullName}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-2)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Full Name */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שם מלא</label>
            <input
              type="text"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              dir="rtl"
            />
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">טלפון</label>
            <input
              type="tel"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
            />
          </div>

          {/* Grade */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שכבה</label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              dir="rtl"
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Class — only when grade has multiple classes */}
          {classOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[var(--text)]">כיתה</label>
              <select
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
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

          {/* Status override — collapsible */}
          <div className="rounded-lg border border-[var(--border)]">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-2)] rounded-lg transition-colors"
              onClick={() => setShowStatusSection((v) => !v)}
            >
              <span>עדכון סטטוס ידני</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={student.currentStatus} />
                {showStatusSection ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </button>

            {showStatusSection && (
              <div className="flex flex-col gap-3 border-t border-[var(--border)] px-3 pb-3 pt-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text)]">סטטוס חדש</label>
                  <select
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value as StudentStatus)}
                    dir="rtl"
                  >
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text)]">הערה (אופציונלי)</label>
                  <input
                    type="text"
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                    value={overrideNote}
                    onChange={(e) => setOverrideNote(e.target.value)}
                    placeholder="הסבר לשינוי הסטטוס..."
                    dir="rtl"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
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
