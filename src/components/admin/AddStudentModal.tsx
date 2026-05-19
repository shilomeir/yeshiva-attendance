import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'

interface AddStudentModalProps {
  onClose: () => void
  onSaved: () => void
}

const fieldStyle: React.CSSProperties = {
  width: '100%', borderRadius: 10,
  border: '1px solid var(--hairline)',
  background: 'rgba(255,255,255,0.7)',
  color: 'var(--ink)',
  padding: '9px 12px',
  fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
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
      toast({ title: 'שגיאה בהוספה', description: getErrorMessage(err, 'הוספת התלמיד נכשלה'), variant: 'destructive' })
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
            הוספת תלמיד חדש
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
            <input
              type="text"
              style={fieldStyle}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              dir="rtl"
              placeholder="ישראל ישראלי"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>מספר זהות</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={9}
              style={{ ...fieldStyle, direction: 'ltr' }}
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder="000000000"
            />
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>9 ספרות בדיוק</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>טלפון</label>
            <input
              type="tel"
              style={{ ...fieldStyle, direction: 'ltr' }}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>שכבה</label>
            <select
              style={fieldStyle}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>כיתה</label>
              <select
                style={fieldStyle}
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
                flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, var(--ink), var(--accent))',
                color: '#fff', fontSize: 13.5, fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1, fontFamily: 'inherit',
              }}
            >
              {saving ? 'מוסיף...' : 'הוסף תלמיד'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
