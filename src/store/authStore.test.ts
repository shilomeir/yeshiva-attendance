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
    supabaseMock.auth.updateUser.mockResolvedValue({ error: null })
    supabaseMock.auth.signOut.mockResolvedValue({ error: null })
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null })

    const changed = await useAuthStore.getState().changeAdminPin('1234', '5678')

    expect(changed).toEqual({ success: true })
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: '5678' })
    expect(supabaseMock.auth.signOut).toHaveBeenCalled()
    expect(supabaseMock.rpc).toHaveBeenCalledWith('verify_admin_pin', { p_pin: '5678' })
    expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@yeshiva.local',
      password: '5678',
    })
    expect(useAuthStore.getState().isAdmin).toBe(true)
  })

  it('rolls the stored PIN back when Supabase Auth password update fails', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: true })
    supabaseMock.auth.updateUser.mockResolvedValue({ error: new Error('auth failed') })

    const changed = await useAuthStore.getState().changeAdminPin('1234', '5678')

    expect(changed).toEqual({ success: false, error: 'auth-sync-failed' })
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'change_admin_pin', {
      p_old_pin: '1234',
      p_new_pin: '5678',
    })
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'change_admin_pin', {
      p_old_pin: '5678',
      p_new_pin: '1234',
    })
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled()
    expect(supabaseMock.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
