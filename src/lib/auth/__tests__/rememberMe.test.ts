import { beforeEach, describe, expect, it } from 'vitest'
import {
  rememberStudent,
  rememberAdmin,
  rememberSupervisor,
  getRememberedSession,
  clearRememberedSession,
  forgetRole,
  REMEMBER_STUDENT_KEY,
  REMEMBER_ADMIN_KEY,
  REMEMBER_SUPERVISOR_KEY,
} from '@/lib/auth/rememberMe'

// The test environment is `node` (no DOM); install a minimal in-memory localStorage.
function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size },
    },
  })
}

describe('rememberMe', () => {
  beforeEach(() => { installLocalStorage() })

  it('remembers exactly one identity per device (writing one clears the others)', () => {
    rememberStudent('123456789')
    rememberSupervisor('1234001')
    expect(localStorage.getItem(REMEMBER_STUDENT_KEY)).toBeNull()
    rememberAdmin('1234')
    expect(localStorage.getItem(REMEMBER_SUPERVISOR_KEY)).toBeNull()
    expect(localStorage.getItem(REMEMBER_ADMIN_KEY)).toBe('1234')
  })

  it('reads back with admin > supervisor > student priority', () => {
    rememberStudent('123456789')
    expect(getRememberedSession()).toEqual({ role: 'student', value: '123456789' })
    rememberSupervisor('1234001')
    expect(getRememberedSession()).toEqual({ role: 'supervisor', value: '1234001' })
    rememberAdmin('1234')
    expect(getRememberedSession()).toEqual({ role: 'admin', value: '1234' })
  })

  it('clearRememberedSession removes every key incl. the legacy student key', () => {
    rememberAdmin('1234')
    localStorage.setItem('yeshiva_last_id', '999')
    clearRememberedSession()
    expect(getRememberedSession()).toBeNull()
    expect(localStorage.getItem('yeshiva_last_id')).toBeNull()
  })

  it('forgetRole removes only the named role', () => {
    rememberSupervisor('1234001')
    forgetRole('admin') // no-op
    expect(getRememberedSession()?.role).toBe('supervisor')
    forgetRole('supervisor')
    expect(getRememberedSession()).toBeNull()
  })
})
