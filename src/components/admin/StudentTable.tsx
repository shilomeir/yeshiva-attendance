import { useState } from 'react'
import { StudentRow } from '@/components/admin/StudentRow'
import { StudentEditModal } from '@/components/admin/StudentEditModal'
import { useStudentsStore } from '@/store/studentsStore'
import type { Student } from '@/types'

export function StudentTable() {
  const { filteredStudents, loadStudents, refreshStudent } = useStudentsStore()
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)

  if (filteredStudents.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--ink-faint)', fontSize: 13.5 }}>
        <p>לא נמצאו תלמידים</p>
      </div>
    )
  }

  return (
    <>
      <div>
        {filteredStudents.map((student) => (
          <div key={student.id} style={{ height: 72 }}>
            <StudentRow
              student={student}
              onUpdate={loadStudents}
              onEditClass={setEditingStudent}
            />
          </div>
        ))}
      </div>

      {editingStudent && (
        <StudentEditModal
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
