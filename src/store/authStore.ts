import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDeviceToken } from '@/lib/auth/deviceToken'
import { parseClassSupervisorSuffix, type ClassSupervisorInfo } from '@/lib/auth/supervisorAuth'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { registerPushNotifications } from '@/lib/native/pushNotifications'
import { unsubscribeFromPush } from '@/lib/pwa/webPush'
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
    (set, get) => ({
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
          // Stamp lastSeen on login so the device is always visible in Supabase
          const now = new Date().toISOString()
          supabase.from('students').update({ lastSeen: now }).eq('id', student.id).then(() => {})
          set({ currentUser: { ...student, lastSeen: now }, isAdmin: false, classSupervisor: null, isLoading: false })
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

        // New format: exactly 3 digits → look up class code in app_settings
        if (/^\d{3}$/.test(suffix)) {
          const { data: codeRow } = await supabase
            .from('app_settings')
            .select('key')
            .eq('value', suffix)
            .like('key', 'class_code_%')
            .maybeSingle()
          if (codeRow) {
            const classId = codeRow.key.replace('class_code_', '')
            const { data: sample } = await supabase
              .from('students')
              .select('grade')
              .eq('classId', classId)
              .limit(1)
              .maybeSingle()
            set({
              classSupervisor: { classId, gradeName: sample?.grade ?? '' },
              isAdmin: false,
              currentUser: null,
            })
            return true
          }
        }

        // Legacy format: letter + number (e.g. "a3" → שיעור א' כיתה 3)
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
        const { currentUser } = get()
        if (currentUser?.id) {
          // Clear push token from Supabase (fire-and-forget — logout must stay synchronous)
          supabase.from('students').update({ push_token: null }).eq('id', currentUser.id).then(() => {})
          // Unsubscribe this device from Web Push
          unsubscribeFromPush().catch(() => {})
        }
        localStorage.removeItem('yeshiva_remembered_id')
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
