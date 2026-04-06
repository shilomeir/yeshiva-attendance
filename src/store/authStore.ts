import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDeviceToken } from '@/lib/auth/deviceToken'
import { parseClassSupervisorSuffix, type ClassSupervisorInfo } from '@/lib/auth/supervisorAuth'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { registerPushNotifications } from '@/lib/native/pushNotifications'
import type { Student } from '@/types'

interface AuthState {
  currentUser: Student | null
  isAdmin: boolean
  classSupervisor: ClassSupervisorInfo | null
  deviceToken: string
  isLoading: boolean
  error: string | null
  login: (idNumber: string) => Promise<boolean>
  loginAdmin: (pin: string) => Promise<boolean>
  /** Checks whether the pin is a valid class-supervisor pin. Returns true + sets classSupervisor state on success. */
  loginClassSupervisor: (pin: string) => Promise<boolean>
  changeAdminPin: (oldPin: string, newPin: string) => Promise<boolean>
  logout: () => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      isAdmin: false,
      classSupervisor: null,
      deviceToken: getDeviceToken(),
      isLoading: false,
      error: null,

      login: async (idNumber: string) => {
        set({ isLoading: true, error: null })
        try {
          const student = await api.getStudentByIdNumber(idNumber)
          if (!student) {
            set({ error: 'מספר זהות לא נמצא במערכת', isLoading: false })
            return false
          }
          set({ currentUser: student, isAdmin: false, classSupervisor: null, isLoading: false })
          registerPushNotifications(student.id)
          return true
        } catch {
          set({ error: 'שגיאה בהתחברות. נסה שוב.', isLoading: false })
          return false
        }
      },

      loginAdmin: async (pin: string) => {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'admin_pin')
          .single()
        if (data?.value === pin) {
          set({ isAdmin: true, classSupervisor: null, currentUser: null })
          return true
        }
        return false
      },

      loginClassSupervisor: async (pin: string) => {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'admin_pin')
          .single()
        const adminPin = data?.value as string | undefined
        if (!adminPin) return false

        // Pin must start with admin pin but not be equal to it
        if (!pin.startsWith(adminPin) || pin === adminPin) return false

        const suffix = pin.slice(adminPin.length)
        const classInfo = parseClassSupervisorSuffix(suffix)
        if (!classInfo) return false

        set({ classSupervisor: classInfo, isAdmin: false, currentUser: null })
        return true
      },

      changeAdminPin: async (oldPin: string, newPin: string) => {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'admin_pin')
          .single()
        if (data?.value !== oldPin) return false
        await supabase
          .from('app_settings')
          .update({ value: newPin })
          .eq('key', 'admin_pin')
        return true
      },

      logout: () => {
        set({ currentUser: null, isAdmin: false, classSupervisor: null, error: null })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'yeshiva-auth',
      // Only persist deviceToken — session state resets on page reload
      partialize: (state) => ({
        deviceToken: state.deviceToken,
      }),
    }
  )
)
