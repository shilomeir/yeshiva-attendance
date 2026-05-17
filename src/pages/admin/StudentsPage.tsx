import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { Download, UserPlus } from 'lucide-react'
import { FilterBar } from '@/components/admin/FilterBar'
import { StudentTable } from '@/components/admin/StudentTable'
import { AddStudentModal } from '@/components/admin/AddStudentModal'
import { useStudentsStore, normalizeHebrew } from '@/store/studentsStore'
import { Button } from '@/components/ui/button'
import { GRADE_LEVELS } from '@/lib/constants/grades'
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
      'סטטוס': s.currentStatus === 'ON_CAMPUS' ? 'בישיבה' : 'מחוץ לישיבה',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, level.name)
  }

  XLSX.writeFile(wb, 'תלמידים.xlsx')
}

// ── FilterPill ────────────────────────────────────────────────────────────────

interface FilterPillProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  small?: boolean
}

function FilterPill({ active, onClick, children, small }: FilterPillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: small ? '4px 10px' : '6px 14px',
        borderRadius: 999, cursor: 'pointer',
        border: '1px solid ' + (active ? 'var(--ink)' : 'var(--hairline)'),
        background: active ? 'var(--ink)' : 'rgba(255,255,255,0.55)',
        color: active ? 'white' : 'var(--ink-muted)',
        fontSize: small ? 12 : 13, fontWeight: 500, fontFamily: 'inherit',
        transition: 'all 0.18s',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {children}
    </button>
  )
}

function CountBadge({ active, count }: { active: boolean; count: number }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
      background: active ? 'rgba(255,255,255,0.18)' : 'rgba(20,18,25,0.06)',
      color: active ? 'white' : 'var(--ink-faint)',
      marginInlineStart: 2,
    }}>
      {count}
    </span>
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
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    loadStudents()
  }, [])

  const classOptions = selectedGrade
    ? [...new Set(
        students
          .filter((s) => s.grade && normalizeHebrew(s.grade) === normalizeHebrew(selectedGrade))
          .map((s) => s.classId)
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'he'))
    : []
  const showClassTabs = classOptions.length > 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
            תלמידים · ניהול
          </div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>
            {isLoading ? '...' : filteredStudents.length}
            {' '}
            <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>מתוך {students.length}</span>
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5 }}>
            ניהול רשימת התלמידים, יבוא/יצוא Excel, סינון לפי שכבה, כיתה, סטטוס.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={() => exportToXlsx(students)} className="flex items-center gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" />
            ייצוא Excel
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 text-xs">
            <UserPlus className="h-3.5 w-3.5" />
            הוסף תלמיד
          </Button>
        </div>
      </div>

      {/* ── Filter card ─────────────────────────────────────────────────── */}
      <div className="glass" style={{ padding: 'var(--card-pad)' }}>

        {/* Grade pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <FilterPill active={!selectedGrade} onClick={() => { setGrade(null); setClass(null) }}>
            הכל
            <CountBadge active={!selectedGrade} count={students.length} />
          </FilterPill>
          {GRADE_LEVELS.map((g) => {
            const isActive = selectedGrade != null && normalizeHebrew(selectedGrade) === normalizeHebrew(g.name)
            const normalG = normalizeHebrew(g.name)
            const count = students.filter((s) => s.grade && normalizeHebrew(s.grade) === normalG).length
            return (
              <FilterPill key={g.name} active={isActive} onClick={() => { setGrade(g.name); setClass(null) }}>
                {g.name}
                {count > 0 && <CountBadge active={isActive} count={count} />}
              </FilterPill>
            )
          })}
        </div>

        {/* Class sub-pills */}
        {showClassTabs && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--hairline)' }}>
            <FilterPill small active={!selectedClass} onClick={() => setClass(null)}>כל הכיתות</FilterPill>
            {classOptions.map((cls) => {
              const normalCls = normalizeHebrew(cls)
              const isActive = selectedClass != null && normalizeHebrew(selectedClass) === normalCls
              const normalG = selectedGrade ? normalizeHebrew(selectedGrade) : ''
              const count = students.filter(
                (s) =>
                  s.grade && normalizeHebrew(s.grade) === normalG &&
                  s.classId && normalizeHebrew(s.classId) === normalCls
              ).length
              const label = cls.split(' ').slice(-2).join(' ')
              return (
                <FilterPill small key={cls} active={isActive} onClick={() => setClass(cls)}>
                  {label}
                  {count > 0 && <CountBadge active={isActive} count={count} />}
                </FilterPill>
              )
            })}
          </div>
        )}

        {/* Status filter + search */}
        <FilterBar />
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="glass" style={{ padding: 0, overflow: 'hidden', minHeight: 200 }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, color: 'var(--ink-faint)' }}>
            טוען תלמידים...
          </div>
        ) : (
          <StudentTable />
        )}
      </div>

      {showAddModal && (
        <AddStudentModal
          onClose={() => setShowAddModal(false)}
          onSaved={loadStudents}
        />
      )}
    </div>
  )
}
