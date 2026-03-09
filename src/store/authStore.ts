import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDeviceToken } from '@/lib/auth/deviceToken'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Student } from '@/types'

interface AuthState {
  currentUser: Student | null
  isAdmin: boolean
  deviceToken: string
  isLoading: boolean
  error: string | null
  login: (idNumber: string) => Promise<boolean>
  loginAdmin: (pin: string) => Promise<boolean>
  changeAdminPin: (oldPin: string, newPin: string) => Promise<boolean>
  logout: () => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      isAdmin: false,
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
          // No device binding — any device can log in with ID number
          set({ currentUser: student, isAdmin: false, isLoading: false })
          return true
        } catch (error) {
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
          set({ isAdmin: true, currentUser: null })
          return true
        }
        return false
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
        set({ currentUser: null, isAdmin: false, error: null })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'yeshiva-auth',
      // Only persist deviceToken — currentUser & isAdmin reset on every page load
      // so the user always lands on the login screen when reopening the app
      partialize: (state) => ({
        deviceToken: state.deviceToken,
      }),
    }
  )
)
