import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'

interface AddStudentModalProps {
  onClose: () => void
  onSaved: () => void
}

export function AddStudentModal({ onClose, onSaved }: AddStudentModalProps) {
  const [fullName, setFullName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [selectedGrade, setSelectedGrade] = useState<string>(GRADE_LEVELS[0].name)
  const [selectedClass, setSelectedClass] = useState(getClasses(GRADE_LEVELS[0].name)[0] ?? '')
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
    if (!/^\d{9}$/.test(idNumber)) {
      toast({ title: 'שגיאה', description: 'מספר זהות חייב להיות 9 ספרות', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const result = await api.addStudent({
        fullName: fullName.trim(),
        idNumber,
        phone: phone.trim(),
        grade: selectedGrade,
        classId: selectedClass,
      })
      if (result.error) {
        toast({ title: 'שגיאה בהוספה', description: result.error.message, variant: 'destructive' })
        return
      }
      toast({ title: 'התלמיד נוסף בהצלחה', description: fullName.trim() })
      onSaved()
      onClose()
    } catch (err) {
      toast({
        title: 'שגיאה בהוספה',
        description: getErrorMessage(err, 'הוספת התלמיד נכשלה'),
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
          <h3 className="text-base font-bold text-[var(--text)]">הוספת תלמיד חדש</h3>
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
              placeholder="ישראל ישראלי"
            />
          </div>

          {/* ID Number */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">מספר זהות</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={9}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
              dir="ltr"
              placeholder="000000000"
            />
            <span className="text-xs text-[var(--text-muted)]">9 ספרות בדיוק</span>
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
              placeholder="050-0000000"
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

          {/* Actions */}
          <div className="mt-1 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              ביטול
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'מוסיף...' : 'הוסף תלמיד'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
