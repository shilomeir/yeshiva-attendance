import { create } from 'zustand'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Student, StudentStatus } from '@/types'

type FilterType = 'ALL' | 'OFF_CAMPUS' | 'PENDING' | 'OVERDUE'

interface StudentsState {
  students: Student[]
  isLoading: boolean
  error: string | null
  filter: FilterType
  searchQuery: string
  selectedGrade: string | null
  selectedClass: string | null

  // Derived
  filteredStudents: Student[]

  // Actions
  setFilter: (filter: FilterType) => void
  setSearch: (query: string) => void
  setGrade: (grade: string | null) => void
  setClass: (classId: string | null) => void
  loadStudents: () => Promise<void>
  updateStudentStatus: (id: string, status: StudentStatus) => Promise<void>
  refreshStudent: (id: string) => Promise<void>
  deleteStudent: (id: string) => Promise<void>
  subscribeToRealtime: () => () => void
}

function applyFilter(
  students: Student[],
  filter: FilterType,
  search: string,
  grade: string | null,
  classId: string | null
): Student[] {
  let result = students

  if (filter === 'OFF_CAMPUS') {
    result = result.filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE')
  } else if (filter === 'PENDING') {
    result = result.filter((s) => s.pendingApproval)
  }

  if (grade) {
    result = result.filter((s) => s.grade === grade)
  }
  if (classId) {
    result = result.filter((s) => s.classId === classId)
  }

  if (search) {
    const q = search.toLowerCase()
    result = result.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.idNumber.includes(q) ||
        s.phone.includes(q)
    )
  }

  return result
}

export const useStudentsStore = create<StudentsState>()((set, get) => ({
  students: [],
  isLoading: false,
  error: null,
  filter: 'ALL',
  searchQuery: '',
  selectedGrade: null,
  selectedClass: null,
  filteredStudents: [],

  setFilter: (filter) => {
    const { students, searchQuery, selectedGrade, selectedClass } = get()
    set({
      filter,
      filteredStudents: applyFilter(students, filter, searchQuery, selectedGrade, selectedClass),
    })
  },

  setSearch: (query) => {
    const { students, filter, selectedGrade, selectedClass } = get()
    set({
      searchQuery: query,
      filteredStudents: applyFilter(students, filter, query, selectedGrade, selectedClass),
    })
  },

  setGrade: (grade) => {
    const { students, filter, searchQuery } = get()
    set({
      selectedGrade: grade,
      selectedClass: null, // reset class when grade changes
      filteredStudents: applyFilter(students, filter, searchQuery, grade, null),
    })
  },

  setClass: (classId) => {
    const { students, filter, searchQuery, selectedGrade } = get()
    set({
      selectedClass: classId,
      filteredStudents: applyFilter(students, filter, searchQuery, selectedGrade, classId),
    })
  },

  loadStudents: async () => {
    set({ isLoading: true, error: null })
    try {
      const students = await api.getStudents()
      const { filter, searchQuery, selectedGrade, selectedClass } = get()
      set({
        students,
        filteredStudents: applyFilter(students, filter, searchQuery, selectedGrade, selectedClass),
        isLoading: false,
      })
    } catch (error) {
      set({ error: 'שגיאה בטעינת רשימת התלמידים', isLoading: false })
    }
  },

  updateStudentStatus: async (id: string, status: StudentStatus) => {
    const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
    const updatedStudents = students.map((s) =>
      s.id === id
        ? { ...s, currentStatus: status, lastSeen: new Date().toISOString() }
        : s
    )
    set({
      students: updatedStudents,
      filteredStudents: applyFilter(updatedStudents, filter, searchQuery, selectedGrade, selectedClass),
    })

    try {
      await api.updateStudentStatus(id, status)
    } catch (error) {
      set({
        students,
        filteredStudents: applyFilter(students, filter, searchQuery, selectedGrade, selectedClass),
        error: 'שגיאה בעדכון הסטטוס',
      })
    }
  },

  refreshStudent: async (id: string) => {
    try {
      const updated = await api.getStudent(id)
      if (!updated) return

      const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
      const updatedStudents = students.map((s) => (s.id === id ? updated : s))
      set({
        students: updatedStudents,
        filteredStudents: applyFilter(updatedStudents, filter, searchQuery, selectedGrade, selectedClass),
      })
    } catch (error) {
      console.error('Failed to refresh student:', error)
    }
  },

  deleteStudent: async (id: string) => {
    const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
    const remaining = students.filter((s) => s.id !== id)
    set({
      students: remaining,
      filteredStudents: applyFilter(remaining, filter, searchQuery, selectedGrade, selectedClass),
    })
    try {
      await api.deleteStudent(id)
    } catch (error) {
      set({ students, filteredStudents: applyFilter(students, filter, searchQuery, selectedGrade, selectedClass) })
    }
  },

  subscribeToRealtime: () => {
    const channel = supabase
      .channel('students-global-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'students' }, (payload) => {
        const newStudent = payload.new as Student
        const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
        const updated = [...students, newStudent]
        set({ students: updated, filteredStudents: applyFilter(updated, filter, searchQuery, selectedGrade, selectedClass) })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' }, (payload) => {
        const updatedStudent = payload.new as Student
        const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
        const updated = students.map((s) => s.id === updatedStudent.id ? updatedStudent : s)
        set({ students: updated, filteredStudents: applyFilter(updated, filter, searchQuery, selectedGrade, selectedClass) })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'students' }, (payload) => {
        const deletedId = (payload.old as { id: string }).id
        const { students, filter, searchQuery, selectedGrade, selectedClass } = get()
        const updated = students.filter((s) => s.id !== deletedId)
        set({ students: updated, filteredStudents: applyFilter(updated, filter, searchQuery, selectedGrade, selectedClass) })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  },
}))
