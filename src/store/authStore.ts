import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getDeviceToken } from '@/lib/auth/deviceToken'
import type { ClassSupervisorInfo } from '@/lib/auth/supervisorAuth'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { unsubscribeFromPush } from '@/lib/pwa/webPush'
import { getErrorMessage } from '@/lib/errors'
import type { Student } from '@/types'

const ADMIN_EMAIL = 'admin@yeshiva.local'

type ChangeAdminPinResult =
  | { success: true }
  | { success: false; error: 'invalid-current-pin' | 'change-failed' | 'login-verification-failed' }

interface AuthState {
  currentUser: Student | null
  isAdmin: boolean
  classSupervisor: ClassSupervisorInfo | null
  deviceToken: string
  isLoading: boolean
  error: string | null
  /** Admin PIN held in-memory (session only, never persisted) for ADMIN_OVERRIDE PIN verification */
  _adminPinSession: string | null
  /** Supervisor PIN held in-memory (session only, never persisted) for audit RPC calls */
  _supervisorPinSession: string | null
  login: (idNumber: string) => Promise<boolean>
  loginAdmin: (pin: string) => Promise<boolean>
  /** Checks whether the pin is a valid class-supervisor pin. Returns true + sets classSupervisor state on success. */
  loginClassSupervisor: (pin: string) => Promise<boolean>
  changeAdminPin: (oldPin: string, newPin: string) => Promise<ChangeAdminPinResult>
  /** Rehydrate the isAdmin flag from the Supabase Auth session on app boot.
   *  Only deviceToken is persisted by Zustand, so without this every refresh
   *  would bounce admin/supervisor users back to /login. PIN cache stays empty
   *  by design — the next audit RPC will trigger PinPromptDialog. */
  restoreAuth: () => Promise<void>
  logout: () => void
  clearError: () => void
  getAdminPin: () => string | null
  getSupervisorPin: () => string | null
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
      _adminPinSession: null,
      _supervisorPinSession: null,

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
          return true
        } catch (err) {
          set({ error: getErrorMessage(err, 'ההתחברות נכשלה'), isLoading: false })
          return false
        }
      },

      loginAdmin: async (pin: string) => {
        // Verify PIN via SECURITY DEFINER RPC - never exposes the stored value
        const { data: valid } = await supabase.rpc('verify_admin_pin', { p_pin: pin })
        if (!valid) return false
        // Sign in as the admin Supabase Auth user so RLS policies allow full access
        const { error } = await supabase.auth.signInWithPassword({
          email: ADMIN_EMAIL,
          password: pin,
        })
        if (error) return false
        // Store PIN in-memory only (not persisted) for ADMIN_OVERRIDE server-side verification
        set({ isAdmin: true, classSupervisor: null, currentUser: null, _adminPinSession: pin })
        return true
      },

      loginClassSupervisor: async (pin: string) => {
        // Verify via SECURITY DEFINER RPC (reads app_settings internally, never exposes values)
        const { data: result } = await supabase.rpc('verify_supervisor_pin', { p_pin: pin })
        if (result && !result.error) {
          set({
            classSupervisor: { classId: result.classId, gradeName: result.gradeName },
            isAdmin: false,
            currentUser: null,
            _supervisorPinSession: pin,
          })
          return true
        }
        return false
      },

      restoreAuth: async () => {
        // Supabase Auth persists its own session in localStorage. If the admin
        // signed in via loginAdmin(), that session survives refresh; we just
        // need to mirror it into the Zustand flag so AdminGuard stops bouncing.
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user?.email === ADMIN_EMAIL) {
            set({ isAdmin: true })
          }
        } catch {
          // best-effort: a failed session check shouldn't block app startup
        }
      },

      changeAdminPin: async (oldPin: string, newPin: string) => {
        const { data: changed, error: changeError } = await supabase.rpc('change_admin_pin', {
          p_old_pin: oldPin,
          p_new_pin: newPin,
        })
        if (changeError) return { success: false, error: 'change-failed' }
        if (!changed) return { success: false, error: 'invalid-current-pin' }

        await supabase.auth.signOut()
        set({ isAdmin: false, classSupervisor: null, currentUser: null })

        const loginVerified = await get().loginAdmin(newPin)
        if (!loginVerified) return { success: false, error: 'login-verification-failed' }
        return { success: true }
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
        set({ currentUser: null, isAdmin: false, classSupervisor: null, error: null, _adminPinSession: null, _supervisorPinSession: null })
      },

      clearError: () => set({ error: null }),

      getAdminPin: () => get()._adminPinSession,
      getSupervisorPin: () => get()._supervisorPinSession,
    }),
    {
      name: 'yeshiva-auth',
      // We persist:
      //  - deviceToken: identifies the install across refreshes
      //  - classSupervisor: a UI identity flag (classId + gradeName). Without
      //    persistence the supervisor gets bounced to /login on every refresh,
      //    which breaks mid-audit. The real authorisation gate is the PIN
      //    check inside every audit RPC, NOT this flag, so persisting the
      //    classId here doesn't grant write capability — it only restores
      //    which dashboard to render.
      // We intentionally do NOT persist:
      //  - _adminPinSession / _supervisorPinSession: the PIN itself never
      //    touches disk (PinPromptDialog re-asks on demand)
      //  - isAdmin: derived in restoreAuth() from supabase.auth.getSession()
      //  - currentUser: student login already handled by the Remember Me flow
      partialize: (state) => ({
        deviceToken: state.deviceToken,
        classSupervisor: state.classSupervisor,
      }),
    }
  )
)