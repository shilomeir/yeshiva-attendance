import { useState } from 'react'
import { X } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { GRADE_LEVELS, GRADE_CLASS_MAP } from '@/lib/constants/grades'

interface AddStudentModalProps {
  onClose: () => void
  onSaved: () => void
}

export function AddStudentModal({ onClose, onSaved }: AddStudentModalProps) {
  const [fullName, setFullName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [grade, setGrade] = useState<string>(GRADE_LEVELS[0].name)
  const [classId, setClassId] = useState(GRADE_CLASS_MAP[GRADE_LEVELS[0].name][0])
  const [saving, setSaving] = useState(false)

  const classOptions = GRADE_CLASS_MAP[grade] ?? []

  const handleGradeChange = (newGrade: string) => {
    setGrade(newGrade)
    setClassId(GRADE_CLASS_MAP[newGrade]?.[0] ?? '')
  }

  const handleSave = async () => {
    if (!fullName.trim() || !idNumber.trim() || !classId) {
      toast({ title: 'יש למלא את כל השדות', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const result = await api.addStudent({ idNumber: idNumber.trim(), fullName: fullName.trim(), phone: phone.trim(), grade, classId })
      if (result.error) {
        toast({ title: result.error.message, variant: 'destructive' })
        return
      }
      toast({ title: `תלמיד ${fullName} נוסף בהצלחה` })
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
          <h3 className="text-base font-bold text-[var(--text)]">הוספת תלמיד חדש</h3>
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
              placeholder="ישראל ישראלי"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">מספר זהות (9 ספרות)</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={idNumber} onChange={(e) => setIdNumber(e.target.value)}
              placeholder="000000000" maxLength={9} inputMode="numeric"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">טלפון</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000" inputMode="tel"
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
              {saving ? 'שומר...' : 'הוסף תלמיד'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
