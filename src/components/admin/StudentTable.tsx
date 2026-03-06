import { useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { StudentRow } from '@/components/admin/StudentRow'
import { ClassEditModal } from '@/components/admin/ClassEditModal'
import { useStudentsStore } from '@/store/studentsStore'
import type { Student } from '@/types'

const ROW_HEIGHT = 72

export function StudentTable() {
  const { filteredStudents, loadStudents, refreshStudent } = useStudentsStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)

  const virtualizer = useVirtualizer({
    count: filteredStudents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  if (filteredStudents.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
        <p>לא נמצאו תלמידים</p>
      </div>
    )
  }

  return (
    <>
      {/* Virtualizer — contain:strict clips fixed/absolute children, so modal is rendered outside */}
      <div
        ref={parentRef}
        className="h-full overflow-auto"
        style={{ contain: 'strict' }}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const student = filteredStudents[virtualItem.index]
            return (
              <div
                key={virtualItem.key}
                className="absolute w-full"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <StudentRow
                  student={student}
                  onUpdate={loadStudents}
                  onEditClass={setEditingStudent}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Class edit modal rendered OUTSIDE contain:strict so fixed positioning works correctly */}
      {editingStudent && (
        <ClassEditModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={async () => {
            await refreshStudent(editingStudent.id)
            loadStudents()
          }}
        />
      )}
    </>
  )
}
