/**
 * "Remember me" persistence — shared across all three roles.
 *
 * Security model (mirrors the existing student flow):
 *  - Only the login credential is stored (student ID number, or admin/supervisor PIN).
 *  - It is written ONLY when the user opts in via the "Remember me" banner.
 *  - On boot the credential is ALWAYS re-verified against the server
 *    (loginAdmin/loginClassSupervisor/login). Stale local data alone never grants
 *    access — if the PIN/ID was changed or revoked, verification fails and the key
 *    is cleared.
 *  - logout() clears every key.
 *
 * Only one identity is remembered per device: writing one role clears the others.
 */

export const REMEMBER_STUDENT_KEY = 'yeshiva_remembered_id'
export const REMEMBER_ADMIN_KEY = 'yeshiva_remembered_admin_pin'
export const REMEMBER_SUPERVISOR_KEY = 'yeshiva_remembered_supervisor_pin'
/** Legacy student key kept only so we can purge it on logout. */
const LEGACY_STUDENT_KEY = 'yeshiva_last_id'

export type RememberedRole = 'admin' | 'supervisor' | 'student'

export function clearRememberedSession(): void {
  localStorage.removeItem(REMEMBER_STUDENT_KEY)
  localStorage.removeItem(REMEMBER_ADMIN_KEY)
  localStorage.removeItem(REMEMBER_SUPERVISOR_KEY)
  localStorage.removeItem(LEGACY_STUDENT_KEY)
}

export function rememberStudent(idNumber: string): void {
  clearRememberedSession()
  localStorage.setItem(REMEMBER_STUDENT_KEY, idNumber)
}

export function rememberAdmin(pin: string): void {
  clearRememberedSession()
  localStorage.setItem(REMEMBER_ADMIN_KEY, pin)
}

export function rememberSupervisor(pin: string): void {
  clearRememberedSession()
  localStorage.setItem(REMEMBER_SUPERVISOR_KEY, pin)
}

/** Returns the single remembered identity, admin → supervisor → student priority. */
export function getRememberedSession(): { role: RememberedRole; value: string } | null {
  const admin = localStorage.getItem(REMEMBER_ADMIN_KEY)
  if (admin) return { role: 'admin', value: admin }
  const supervisor = localStorage.getItem(REMEMBER_SUPERVISOR_KEY)
  if (supervisor) return { role: 'supervisor', value: supervisor }
  const student = localStorage.getItem(REMEMBER_STUDENT_KEY)
  if (student) return { role: 'student', value: student }
  return null
}

export function forgetRole(role: RememberedRole): void {
  if (role === 'admin') localStorage.removeItem(REMEMBER_ADMIN_KEY)
  else if (role === 'supervisor') localStorage.removeItem(REMEMBER_SUPERVISOR_KEY)
  else localStorage.removeItem(REMEMBER_STUDENT_KEY)
}
