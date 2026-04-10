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
        // Verify PIN via SECURITY DEFINER RPC — never exposes the stored value
        const { data: valid } = await supabase.rpc('verify_admin_pin', { p_pin: pin })
        if (!valid) return false
        // Sign in as the admin Supabase Auth user so RLS policies allow full access
        const { error } = await supabase.auth.signInWithPassword({
          email: 'admin@yeshiva.local',
          password: pin,
        })
        if (error) return false
        set({ isAdmin: true, classSupervisor: null, currentUser: null })
        return true
      },

      loginClassSupervisor: async (pin: string) => {
        // Verify via SECURITY DEFINER RPC (reads app_settings internally, never exposes values)
        const { data: result } = await supabase.rpc('verify_supervisor_pin', { p_pin: pin })
        if (result) {
          set({
            classSupervisor: { classId: result.classId, gradeName: result.gradeName },
            isAdmin: false,
            currentUser: null,
          })
          return true
        }

        // Legacy format fallback: adminPin + letter+digit (e.g. "1234a3")
        // Get PIN length without exposing the actual value
        const { data: pinLen } = await supabase.rpc('get_admin_pin_length')
        if (!pinLen || pin.length <= pinLen) return false
        const suffix = pin.slice(pinLen)
        const classInfo = parseClassSupervisorSuffix(suffix)
        if (!classInfo) return false
        set({ classSupervisor: classInfo, isAdmin: false, currentUser: null })
        return true
      },

      changeAdminPin: async (oldPin: string, newPin: string) => {
        const { data: changed } = await supabase.rpc('change_admin_pin', {
          p_old_pin: oldPin,
          p_new_pin: newPin,
        })
        if (!changed) return false
        // Update the Supabase Auth user password to stay in sync
        await supabase.auth.updateUser({ password: newPin })
        return true
      },

      logout: () => {
        const { currentUser, isAdmin } = get()
        if (currentUser?.id) {
          supabase.from('students').update({ push_token: null }).eq('id', currentUser.id).then(() => {})
          unsubscribeFromPush().catch(() => {})
        }
        if (isAdmin) {
          // Sign out from Supabase Auth (admin was signed in as admin@yeshiva.local)
          supabase.auth.signOut().catch(() => {})
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
