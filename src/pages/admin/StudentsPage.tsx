import { useEffect } from 'react'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import { FilterBar } from '@/components/admin/FilterBar'
import { StudentTable } from '@/components/admin/StudentTable'
import { useStudentsStore } from '@/store/studentsStore'
import { Button } from '@/components/ui/button'
import { GRADE_LEVELS, getClasses } from '@/lib/constants/grades'
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
      'סטטוס': s.currentStatus === 'ON_CAMPUS' ? 'בישיבה' : 'מחוץ לישיבה',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, level.name)
  }

  XLSX.writeFile(wb, 'תלמידים.xlsx')
}

// ── Short display label for a classId ────────────────────────────────────────
// "שיעור א' כיתה 3" → "כיתה 3"   |   "אברכים" → "אברכים"
function classLabel(classId: string): string {
  const match = classId.match(/כיתה\s+(\d+)$/)
  return match ? `כיתה ${match[1]}` : classId
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

  useEffect(() => {
    loadStudents()
  }, [])

  const classOptions = selectedGrade ? getClasses(selectedGrade) : []
  const showClassTabs = classOptions.length > 1

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-4 pb-3 space-y-3">

        {/* Title row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[var(--text)]">תלמידים</h2>
            <span className="rounded-full bg-[var(--bg-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]">
              {isLoading ? '...' : filteredStudents.length}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToXlsx(students)}
            className="flex items-center gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            ייצוא Excel
          </Button>
        </div>

        {/* ── Grade tabs ─────────────────────────────────────────── */}
        <div
          className="flex gap-1.5 overflow-x-auto pb-0.5"
          style={{ scrollbarWidth: 'none' }}
        >
          <button
            onClick={() => setGrade(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
              !selectedGrade
                ? 'bg-[var(--blue)] text-white shadow-sm'
                : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
            )}
          >
            הכל
          </button>
          {GRADE_LEVELS.map((g) => {
            const isActive = selectedGrade === g.name
            // Count students in this grade for the badge
            const count = students.filter((s) => s.grade === g.name).length
            return (
              <button
                key={g.name}
                onClick={() => setGrade(g.name)}
                className={cn(
                  'shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
                  isActive
                    ? 'bg-[var(--blue)] text-white shadow-sm'
                    : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
                )}
              >
                {g.name}
                {count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--border)] text-[var(--text-muted)]'
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Class sub-tabs (only when grade has multiple classes) ─ */}
        {showClassTabs && (
          <div
            className="flex gap-1.5 overflow-x-auto pb-0.5"
            style={{ scrollbarWidth: 'none' }}
          >
            <button
              onClick={() => setClass(null)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all',
                !selectedClass
                  ? 'bg-slate-700 text-white shadow-sm dark:bg-slate-300 dark:text-slate-900'
                  : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
              )}
            >
              כל הכיתות
            </button>
            {classOptions.map((cls) => {
              const isActive = selectedClass === cls
              const count = students.filter(
                (s) => s.grade === selectedGrade && s.classId === cls
              ).length
              return (
                <button
                  key={cls}
                  onClick={() => setClass(cls)}
                  className={cn(
                    'shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all',
                    isActive
                      ? 'bg-slate-700 text-white shadow-sm dark:bg-slate-300 dark:text-slate-900'
                      : 'bg-[var(--bg-2)] text-[var(--text-muted)] hover:bg-[var(--border)]'
                  )}
                >
                  {classLabel(cls)}
                  {count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-[var(--border)] text-[var(--text-muted)]'
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Status filter + search ─────────────────────────────── */}
        <FilterBar />
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
            טוען תלמידים...
          </div>
        ) : (
          <StudentTable />
        )}
      </div>
    </div>
  )
}
