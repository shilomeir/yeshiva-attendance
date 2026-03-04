import { useEffect } from 'react'
import { FilterBar } from '@/components/admin/FilterBar'
import { StudentTable } from '@/components/admin/StudentTable'
import { useStudentsStore } from '@/store/studentsStore'

export function StudentsPage() {
  const { loadStudents, filteredStudents, isLoading } = useStudentsStore()

  useEffect(() => {
    loadStudents()
  }, [])

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Fixed filter bar */}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--text)]">תלמידים</h2>
          <span className="text-sm text-[var(--text-muted)]">
            {isLoading ? 'טוען...' : `${filteredStudents.length} תלמידים`}
          </span>
        </div>
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
    </div>
  )
}
