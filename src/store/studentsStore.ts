import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Student, StudentStatus } from '@/types'

type FilterType = 'ALL' | 'OFF_CAMPUS' | 'PENDING' | 'OVERDUE'

interface StudentsState {
  students: Student[]
  isLoading: boolean
  error: string | null
  filter: FilterType
  searchQuery: string

  // Derived
  filteredStudents: Student[]

  // Actions
  setFilter: (filter: FilterType) => void
  setSearch: (query: string) => void
  loadStudents: () => Promise<void>
  updateStudentStatus: (id: string, status: StudentStatus) => Promise<void>
  refreshStudent: (id: string) => Promise<void>
  deleteStudent: (id: string) => Promise<void>
}

function applyFilter(students: Student[], filter: FilterType, search: string): Student[] {
  let result = students

  if (filter === 'OFF_CAMPUS') {
    result = result.filter((s) => s.currentStatus === 'OFF_CAMPUS')
  } else if (filter === 'PENDING') {
    result = result.filter((s) => s.pendingApproval)
  } else if (filter === 'OVERDUE') {
    result = result.filter((s) => s.currentStatus === 'OVERDUE')
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
  filteredStudents: [],

  setFilter: (filter) => {
    const { students, searchQuery } = get()
    set({
      filter,
      filteredStudents: applyFilter(students, filter, searchQuery),
    })
  },

  setSearch: (query) => {
    const { students, filter } = get()
    set({
      searchQuery: query,
      filteredStudents: applyFilter(students, filter, query),
    })
  },

  loadStudents: async () => {
    set({ isLoading: true, error: null })
    try {
      const students = await api.getStudents()
      const { filter, searchQuery } = get()
      set({
        students,
        filteredStudents: applyFilter(students, filter, searchQuery),
        isLoading: false,
      })
    } catch (error) {
      set({ error: 'שגיאה בטעינת רשימת התלמידים', isLoading: false })
    }
  },

  updateStudentStatus: async (id: string, status: StudentStatus) => {
    // Optimistic update
    const { students, filter, searchQuery } = get()
    const updatedStudents = students.map((s) =>
      s.id === id
        ? { ...s, currentStatus: status, lastSeen: new Date().toISOString() }
        : s
    )
    set({
      students: updatedStudents,
      filteredStudents: applyFilter(updatedStudents, filter, searchQuery),
    })

    try {
      await api.updateStudentStatus(id, status)
    } catch (error) {
      // Revert on error
      set({
        students,
        filteredStudents: applyFilter(students, filter, searchQuery),
        error: 'שגיאה בעדכון הסטטוס',
      })
    }
  },

  refreshStudent: async (id: string) => {
    try {
      const updated = await api.getStudent(id)
      if (!updated) return

      const { students, filter, searchQuery } = get()
      const updatedStudents = students.map((s) => (s.id === id ? updated : s))
      set({
        students: updatedStudents,
        filteredStudents: applyFilter(updatedStudents, filter, searchQuery),
      })
    } catch (error) {
      console.error('Failed to refresh student:', error)
    }
  },

  deleteStudent: async (id: string) => {
    const { students, filter, searchQuery } = get()
    const remaining = students.filter((s) => s.id !== id)
    set({
      students: remaining,
      filteredStudents: applyFilter(remaining, filter, searchQuery),
    })
    try {
      await api.deleteStudent(id)
    } catch (error) {
      // revert
      set({ students, filteredStudents: applyFilter(students, filter, searchQuery) })
    }
  },
}))
