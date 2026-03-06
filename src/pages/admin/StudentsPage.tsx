import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Download, Upload, UserPlus } from 'lucide-react'
import { FilterBar } from '@/components/admin/FilterBar'
import { StudentTable } from '@/components/admin/StudentTable'
import { useStudentsStore } from '@/store/studentsStore'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { GRADE_LEVELS, getClasses, DEFAULT_GRADE, DEFAULT_CLASS } from '@/lib/constants/grades'
import { cn } from '@/lib/utils/cn'
import type { Student } from '@/types'

// ── Excel export ──────────────────────────────────────────────────────────────

function exportToXlsx(students: Student[]) {
  const wb = XLSX.utils.book_new()

  for (const level of GRADE_LEVELS) {
    const gradeStudents = students
      .filter((s) => s.grade === level.name)
      .sort((a, b) => {
        if (a.classId !== b.classId) return a.classId.localeCompare(b.classId, 'he')
        return a.fullName.localeCompare(b.fullName, 'he')
      })

    if (gradeStudents.length === 0) continue

    const rows = gradeStudents.map((s) => ({
      'שם מלא': s.fullName,
      'ת.ז.': s.idNumber,
      'טלפון': s.phone,
      'כיתה': s.classId,
      'סטטוס':
        s.currentStatus === 'ON_CAMPUS'
          ? 'בישיבה'
          : s.currentStatus === 'OFF_CAMPUS'
            ? 'מחוץ לישיבה'
            : 'באיחור',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, level.name)
  }

  XLSX.writeFile(wb, 'תלמידים.xlsx')
}

function parseCsvRows(text: string): { fullName: string; idNumber: string; phone: string }[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const lines = clean.split('\n').filter(Boolean)
  const dataLines =
    lines[0]?.includes('שם') || lines[0]?.includes('name') ? lines.slice(1) : lines
  return dataLines
    .map((line) => {
      const parts = line.split(',')
      return {
        fullName: parts[0]?.trim() ?? '',
        idNumber: parts[1]?.trim() ?? '',
        phone: parts[2]?.trim() ?? '',
      }
    })
    .filter((r) => r.fullName && r.idNumber)
}

// ── Add Student Modal ─────────────────────────────────────────────────────────

function AddStudentModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [fullName, setFullName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [grade, setGradeVal] = useState(DEFAULT_GRADE)
  const [classId, setClassId] = useState(DEFAULT_CLASS)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const classOptions = getClasses(grade)

  const handleGradeChange = (newGrade: string) => {
    setGradeVal(newGrade)
    setClassId(getClasses(newGrade)[0])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || !idNumber.trim() || !phone.trim()) {
      setError('יש למלא את כל השדות')
      return
    }
    setSaving(true)
    try {
      await api.addStudent({
        fullName: fullName.trim(),
        idNumber: idNumber.trim(),
        phone: phone.trim(),
        grade,
        classId,
      })
      onAdded()
      onClose()
    } catch {
      setError('שגיאה בהוספת תלמיד')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-bold text-[var(--text)]">הוספת תלמיד חדש</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שם מלא</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="ישראל ישראלי"
              dir="rtl"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">מספר תעודת זהות</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="123456789"
              inputMode="numeric"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">טלפון</label>
            <input
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-1234567"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--text)]">שכבה</label>
            <select
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              value={grade}
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
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                dir="rtl"
              >
                {classOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-[var(--red)]">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'שומר...' : 'הוסף תלמיד'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function StudentsPage() {
  const {
    loadStudents,
    filteredStudents,
    students,
    isLoading,
    selectedGrade,
    selectedClass,
    setGrade,
    setClass,
  } = useStudentsStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  useEffect(() => {
    loadStudents()
  }, [])

  const handleExport = () => exportToXlsx(students)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const rows = parseCsvRows(text)
    if (rows.length === 0) {
      setImportStatus('לא נמצאו שורות תקינות בקובץ')
      return
    }
    setImportStatus(`מייבא ${rows.length} תלמידים...`)
    let added = 0
    for (const row of rows) {
      try {
        await api.addStudent({ ...row, grade: DEFAULT_GRADE, classId: DEFAULT_CLASS })
        added++
      } catch {
        // skip errors/duplicates
      }
    }
    setImportStatus(`✓ יובאו ${added} תלמידים בהצלחה`)
    loadStudents()
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => setImportStatus(null), 4000)
  }

  const classOptions = selectedGrade ? getClasses(selectedGrade) : []
  const showClassTabs = classOptions.length > 1

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        {/* Top row: title + actions */}
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[var(--text)]">תלמידים</h2>
            <span className="text-sm text-[var(--text-muted)]">
              {isLoading ? 'טוען...' : `${filteredStudents.length} תלמידים`}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport} className="flex items-center gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              ייצוא Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" />
              ייבוא CSV
            </Button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport} />
            <Button size="sm" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-xs">
              <UserPlus className="h-3.5 w-3.5" />
              הוסף תלמיד
            </Button>
          </div>
        </div>

        {importStatus && (
          <p className="mb-2 rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-[var(--blue)] dark:bg-blue-950/20">
            {importStatus}
          </p>
        )}

        {/* Grade tabs */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setGrade(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              !selectedGrade ? 'bg-[var(--blue)] text-white' : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
            )}
          >
            הכל
          </button>
          {GRADE_LEVELS.map((g) => (
            <button
              key={g.name}
              onClick={() => setGrade(g.name)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                selectedGrade === g.name ? 'bg-[var(--blue)] text-white' : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
              )}
            >
              {g.name}
            </button>
          ))}
        </div>

        {/* Class sub-tabs */}
        {showClassTabs && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => setClass(null)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                !selectedClass ? 'bg-slate-600 text-white' : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
              )}
            >
              כל הכיתות
            </button>
            {classOptions.map((cls) => (
              <button
                key={cls}
                onClick={() => setClass(cls)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  selectedClass === cls ? 'bg-slate-600 text-white' : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
                )}
              >
                {cls.includes('כיתה') ? `כיתה ${cls.split('כיתה ')[1]}` : cls}
              </button>
            ))}
          </div>
        )}

        <FilterBar />
      </div>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">טוען תלמידים...</div>
        ) : (
          <StudentTable />
        )}
      </div>

      {showAdd && <AddStudentModal onClose={() => setShowAdd(false)} onAdded={loadStudents} />}
    </div>
  )
}
