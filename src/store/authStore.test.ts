import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: {
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(() => ({
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        then: vi.fn(),
      })),
    })),
  })),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}))

vi.mock('@/lib/auth/deviceToken', () => ({
  getDeviceToken: () => 'test-device-token',
}))

vi.mock('@/lib/api', () => ({
  api: {
    getStudentByIdNumber: vi.fn(),
  },
}))

vi.mock('@/lib/native/pushNotifications', () => ({
  registerPushNotifications: vi.fn(),
}))

vi.mock('@/lib/pwa/webPush', () => ({
  unsubscribeFromPush: vi.fn(),
}))

import { useAuthStore } from './authStore'

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

describe('authStore admin PIN changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      currentUser: null,
      isAdmin: true,
      classSupervisor: null,
      deviceToken: 'test-device-token',
      isLoading: false,
      error: null,
    })
  })

  it('verifies the new PIN by signing out and logging in again', async () => {
    supabaseMock.rpc.mockImplementation((name: string) => {
      if (name === 'change_admin_pin') return Promise.resolve({ data: true })
      if (name === 'verify_admin_pin') return Promise.resolve({ data: true })
      return Promise.resolve({ data: null })
    })
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })

    const changed = await useAuthStore.getState().changeAdminPin('1234', '5678')

    expect(changed).toEqual({ success: true })
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled()
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_admin_pin', { p_pin: '5678' })
    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@yeshiva.local',
      password: '5678',
    })
    expect(useAuthStore.getState().isAdmin).toBe(true)
  })

  it('reports a system failure when the transactional PIN change RPC fails', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: new Error('rpc failed') })

    const changed = await useAuthStore.getState().changeAdminPin('1234', '5678')

    expect(changed).toEqual({ success: false, error: 'change-failed' })
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseMock.rpc).toHaveBeenCalledWith('change_admin_pin', {
      p_old_pin: '1234',
      p_new_pin: '5678',
    })
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled()
    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('authStore restoreSession ("Remember me")', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installLocalStorage()
    useAuthStore.setState({
      currentUser: null,
      isAdmin: false,
      classSupervisor: null,
      deviceToken: 'test-device-token',
      isLoading: false,
      error: null,
      _adminPinSession: null,
      _supervisorPinSession: null,
    })
  })

  it('does nothing when no credential is remembered', async () => {
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isAdmin).toBe(false)
    expect(useAuthStore.getState().currentUser).toBeNull()
    expect(supabaseMock.rpc).not.toHaveBeenCalled()
  })

  it('restores a remembered admin by re-verifying the PIN against the server', async () => {
    localStorage.setItem('yeshiva_remembered_admin_pin', '1234')
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_admin_pin' ? Promise.resolve({ data: true }) : Promise.resolve({ data: null }),
    )
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })

    await useAuthStore.getState().restoreSession()

    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_admin_pin', { p_pin: '1234' })
    expect(useAuthStore.getState().isAdmin).toBe(true)
    // PIN kept available in memory for ADMIN_OVERRIDE verification
    expect(useAuthStore.getState().getAdminPin()).toBe('1234')
  })

  it('drops a stale admin PIN when re-verification fails (stale data grants no access)', async () => {
    localStorage.setItem('yeshiva_remembered_admin_pin', '9999')
    supabaseMock.rpc.mockResolvedValue({ data: false }) // verify_admin_pin → false

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().isAdmin).toBe(false)
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBeNull()
  })

  it('restores a remembered supervisor and keeps the PIN for opt-in re-persist', async () => {
    localStorage.setItem('yeshiva_remembered_supervisor_pin', '1234001')
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_supervisor_pin'
        ? Promise.resolve({ data: { classId: 'כיתה הרב אבישי', gradeName: 'שיעור א' } })
        : Promise.resolve({ data: null }),
    )

    await useAuthStore.getState().restoreSession()

    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_supervisor_pin', { p_pin: '1234001' })
    expect(useAuthStore.getState().classSupervisor).toEqual({ classId: 'כיתה הרב אבישי', gradeName: 'שיעור א' })
  })

  it('logout clears every remembered key', () => {
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })
    localStorage.setItem('yeshiva_remembered_admin_pin', '1234')
    localStorage.setItem('yeshiva_remembered_id', '123456789')
    localStorage.setItem('yeshiva_last_id', '123456789')
    useAuthStore.setState({ isAdmin: true })

    useAuthStore.getState().logout()

    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBeNull()
    expect(localStorage.getItem('yeshiva_remembered_id')).toBeNull()
    expect(localStorage.getItem('yeshiva_last_id')).toBeNull()
    expect(useAuthStore.getState().isAdmin).toBe(false)
  })
})

// Full "behaves exactly like a student" lifecycle for admin & supervisor:
// log in → opt in to Remember me → reopen the app → land straight in → log out → cleared.
describe('Remember me — full lifecycle parity with students', () => {
  function reopenApp() {
    // Simulate a fresh page load: in-memory state is gone, localStorage survives.
    useAuthStore.setState({
      currentUser: null, isAdmin: false, classSupervisor: null,
      _adminPinSession: null, _supervisorPinSession: null,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    installLocalStorage()
    reopenApp()
  })

  it('ADMIN: login → Remember me persists the PIN → reopen logs straight in → logout clears', async () => {
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_admin_pin' ? Promise.resolve({ data: true }) : Promise.resolve({ data: null }),
    )
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })

    // 1. Manual login
    expect(await useAuthStore.getState().loginAdmin('1234')).toBe(true)
    expect(useAuthStore.getState().isAdmin).toBe(true)

    // 2. User taps "כן, זכור אותי" → the banner calls rememberSession()
    useAuthStore.getState().rememberSession()
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBe('1234')

    // 3. App is closed and reopened — App.tsx calls restoreSession() on boot
    reopenApp()
    expect(useAuthStore.getState().isAdmin).toBe(false) // before restore
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isAdmin).toBe(true)  // straight in, re-verified vs server
    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_admin_pin', { p_pin: '1234' })

    // 4. Logout clears the remembered credential; a later reopen does NOT log in
    useAuthStore.getState().logout()
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBeNull()
    reopenApp()
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isAdmin).toBe(false)
  })

  it('SUPERVISOR: login → Remember me persists the PIN → reopen logs straight in → logout clears', async () => {
    const classInfo = { classId: 'כיתה הרב אבישי', gradeName: 'שיעור א' }
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_supervisor_pin' ? Promise.resolve({ data: classInfo }) : Promise.resolve({ data: null }),
    )

    // 1. Manual login
    expect(await useAuthStore.getState().loginClassSupervisor('1234001')).toBe(true)
    expect(useAuthStore.getState().classSupervisor).toEqual(classInfo)

    // 2. Opt in to Remember me
    useAuthStore.getState().rememberSession()
    expect(localStorage.getItem('yeshiva_remembered_supervisor_pin')).toBe('1234001')

    // 3. Reopen → restore straight in (re-verified vs server)
    reopenApp()
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().classSupervisor).toEqual(classInfo)
    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_supervisor_pin', { p_pin: '1234001' })

    // 4. Logout clears it
    useAuthStore.getState().logout()
    expect(localStorage.getItem('yeshiva_remembered_supervisor_pin')).toBeNull()
    reopenApp()
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().classSupervisor).toBeNull()
  })

  it('does NOT persist anything when the user declines the banner (no rememberSession call)', async () => {
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_admin_pin' ? Promise.resolve({ data: true }) : Promise.resolve({ data: null }),
    )
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })

    await useAuthStore.getState().loginAdmin('1234')
    // user taps "לא תודה" → rememberSession is never called
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBeNull()
    reopenApp()
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState().isAdmin).toBe(false)
  })

  it('remembers only the current role — switching identities never stacks credentials', async () => {
    supabaseMock.rpc.mockImplementation((name: string) =>
      name === 'verify_admin_pin' ? Promise.resolve({ data: true })
      : name === 'verify_supervisor_pin' ? Promise.resolve({ data: { classId: 'כיתה הרב אבישי', gradeName: 'שיעור א' } })
      : Promise.resolve({ data: null }),
    )
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })

    await useAuthStore.getState().loginAdmin('1234')
    useAuthStore.getState().rememberSession()
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBe('1234')

    useAuthStore.getState().logout()
    await useAuthStore.getState().loginClassSupervisor('1234001')
    useAuthStore.getState().rememberSession()
    // Supervisor key set, admin key gone — exactly one identity remembered.
    expect(localStorage.getItem('yeshiva_remembered_supervisor_pin')).toBe('1234001')
    expect(localStorage.getItem('yeshiva_remembered_admin_pin')).toBeNull()
  })
})