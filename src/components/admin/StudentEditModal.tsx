import { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
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

const selectStyle: React.CSSProperties = {
  width: '100%', borderRadius: 10,
  border: '1px solid var(--hairline)',
  background: 'rgba(255,255,255,0.7)', color: 'var(--ink)',
  padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
}

const inputStyle: React.CSSProperties = {
  ...selectStyle,
}

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
        const result = await api.updateStudent(student.id, { fullName: fullName.trim(), phone: phone.trim() })
        if (result.error) {
          toast({ title: 'שגיאה בשמירה', description: result.error.message, variant: 'destructive' })
          return
        }
      }
      if (classChanged) await api.updateStudentGrade(student.id, selectedGrade, selectedClass)
      if (statusChanged) await api.createAdminOverride(student.id, overrideStatus, overrideNote || undefined)

      toast({ title: 'פרטי התלמיד עודכנו בהצלחה' })
      onSaved()
      onClose()
    } catch (err) {
      toast({ title: 'שגיאה בשמירה', description: getErrorMessage(err, 'שמירת פרטי התלמיד נכשלה'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(15,23,42,0.45)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--glass-2)',
        backdropFilter: 'blur(28px) saturate(150%)',
        border: '1px solid var(--hairline)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: '24px 24px 0 0',
        padding: 24,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
            עריכת תלמיד
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--hairline)',
              background: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-faint)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>שם מלא</label>
            <input type="text" style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} dir="rtl" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>טלפון</label>
            <input type="tel" style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>שכבה</label>
            <select style={selectStyle} value={selectedGrade} onChange={(e) => handleGradeChange(e.target.value)} dir="rtl">
              {GRADE_LEVELS.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>

          {classOptions.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>כיתה</label>
              <select style={selectStyle} value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} dir="rtl">
                {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Status override */}
          <div style={{ borderRadius: 12, border: '1px solid var(--hairline)' }}>
            <button
              type="button"
              onClick={() => setShowStatusSection((v) => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: 'var(--ink-muted)', fontFamily: 'inherit',
              }}
            >
              <span>עדכון סטטוס ידני</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={student.currentStatus} />
                {showStatusSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>

            {showStatusSection && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                borderTop: '1px solid var(--hairline)', padding: '12px',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>סטטוס חדש</label>
                  <select style={selectStyle} value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value as StudentStatus)} dir="rtl">
                    {STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>הערה (אופציונלי)</label>
                  <input
                    type="text"
                    style={inputStyle}
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
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: '10px', borderRadius: 10,
                border: '1px solid var(--hairline)', background: 'rgba(255,255,255,0.6)',
                color: 'var(--ink-muted)', fontSize: 13.5, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ביטול
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: '10px', borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg, var(--ink), var(--accent))',
                color: '#fff', fontSize: 13.5, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1, fontFamily: 'inherit',
              }}
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
