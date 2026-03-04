import { useEffect, useRef, useState } from 'react'
import { Download, Upload, UserPlus } from 'lucide-react'
import { FilterBar } from '@/components/admin/FilterBar'
import { StudentTable } from '@/components/admin/StudentTable'
import { useStudentsStore } from '@/store/studentsStore'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

// ── CSV helpers ────────────────────────────────────────────────────────────────

function exportToCsv(rows: { fullName: string; idNumber: string; phone: string }[]) {
  const BOM = '\uFEFF' // UTF-8 BOM so Hebrew renders correctly in Excel
  const header = 'שם מלא,מספר תעודת זהות,טלפון'
  const lines = rows.map((r) => `${r.fullName},${r.idNumber},${r.phone}`)
  const csv = BOM + [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'תלמידים.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function parseCsvRows(text: string): { fullName: string; idNumber: string; phone: string }[] {
  // Remove BOM if present
  const clean = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const lines = clean.split('\n').filter(Boolean)
  // Skip header if it contains Hebrew text
  const dataLines = lines[0]?.includes('שם') || lines[0]?.includes('name') ? lines.slice(1) : lines
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
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName.trim() || !idNumber.trim() || !phone.trim()) {
      setError('יש למלא את כל השדות')
      return
    }
    setSaving(true)
    try {
      await api.addStudent({ fullName: fullName.trim(), idNumber: idNumber.trim(), phone: phone.trim() })
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
  const { loadStudents, filteredStudents, students, isLoading } = useStudentsStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  useEffect(() => {
    loadStudents()
  }, [])

  const handleExport = () => {
    exportToCsv(
      students.map((s) => ({ fullName: s.fullName, idNumber: s.idNumber, phone: s.phone }))
    )
  }

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
        await api.addStudent(row)
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

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[var(--text)]">תלמידים</h2>
            <span className="text-sm text-[var(--text-muted)]">
              {isLoading ? 'טוען...' : `${filteredStudents.length} תלמידים`}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="flex items-center gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              ייצוא Excel
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              ייבוא CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImport}
            />

            <Button
              size="sm"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-xs"
            >
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

        <FilterBar />
      </div>

      {/* Virtualized table */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            טוען תלמידים...
          </div>
        ) : (
          <StudentTable />
        )}
      </div>

      {showAdd && (
        <AddStudentModal onClose={() => setShowAdd(false)} onAdded={loadStudents} />
      )}
    </div>
  )
}
