import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    functions: {
      invoke: mocks.invoke,
    },
    from: mocks.from,
  },
}))

vi.mock('@/lib/db/schema', () => ({
  db: {},
}))

vi.mock('@/lib/sync/syncEngine', () => ({
  notifyQueueChanged: vi.fn(),
}))

import { SupabaseApiClient } from '@/lib/api/supabaseClient'

/** Builder for a chained Supabase query mock that resolves via .single() */
function singleResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

/** Builder for an update chain mock (no .single() — just resolves) */
function updateResult() {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

/** Flush all pending microtasks so void'd async chains complete */
async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

// ─── Shilo Meir fixture (the only student registered for push notifications) ──
const SHILO_MEIR_STUDENT_ID = '5aa8978e-947f-4a11-aee7-1f3bfa5807ef'
const SHILO_MEIR_DEPARTURE_ID = 'dep-avishai-001'
const SHILO_MEIR_PUSH_TOKEN =
  '{"endpoint":"https://fcm.googleapis.com/fcm/send/fD2DYuQ6NaI:APA91bFQ","expirationTime":null,"keys":{"p256dh":"BEjhAiKidc8Dkhwjijp384jTKrjfVQIpcyxZTkvC3z_6U9f2deEcFLU1G6_9o3jTTgiaBJgR3q0PSgVm2shbu5I","auth":"GeRwoJbYc2SJHes7P4Ra-A"}}'

describe('SupabaseApiClient push notifications', () => {
  const api = new SupabaseApiClient()

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: invoke returns successful push
    mocks.invoke.mockResolvedValue({ data: { sent: true }, error: null })
  })

  // ── Approval push ──────────────────────────────────────────────────────────

  describe('approveDeparture → _sendApprovalPush', () => {
    it('sends the approval push to the correct student (Shilo Meir)', async () => {
      mocks.rpc.mockResolvedValue({
        data: { id: SHILO_MEIR_DEPARTURE_ID, status: 'APPROVED' },
        error: null,
      })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        throw new Error(`Unexpected table: ${table}`)
      })

      const result = await api.approveDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin', 'ADMIN', 'מאושר')
      expect(result).toEqual({ id: SHILO_MEIR_DEPARTURE_ID, status: 'APPROVED' })

      await flushMicrotasks()

      expect(mocks.invoke).toHaveBeenCalledWith('send-push', {
        body: {
          subscription: SHILO_MEIR_PUSH_TOKEN,
          title: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉',
          body: 'מאושר',
        },
      })
    })

    it('uses default body when no admin note is provided', async () => {
      mocks.rpc.mockResolvedValue({
        data: { id: SHILO_MEIR_DEPARTURE_ID, status: 'APPROVED' },
        error: null,
      })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.approveDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin')
      await flushMicrotasks()

      expect(mocks.invoke).toHaveBeenCalledWith('send-push', {
        body: {
          subscription: SHILO_MEIR_PUSH_TOKEN,
          title: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉',
          body: 'הבקשה שלך אושרה על ידי הנהלת הישיבה',
        },
      })
    })

    it('also sends approval push when departure is immediately ACTIVE', async () => {
      mocks.rpc.mockResolvedValue({
        data: { id: SHILO_MEIR_DEPARTURE_ID, status: 'ACTIVE' },
        error: null,
      })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.approveDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin')
      await flushMicrotasks()

      expect(mocks.invoke).toHaveBeenCalledWith('send-push', expect.objectContaining({
        body: expect.objectContaining({ title: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉' }),
      }))
    })

    it('clears stale push_token when send-push reports subscription is gone', async () => {
      mocks.rpc.mockResolvedValue({
        data: { id: SHILO_MEIR_DEPARTURE_ID, status: 'APPROVED' },
        error: null,
      })
      // send-push reports the subscription is no longer valid (410 Gone)
      mocks.invoke.mockResolvedValue({ data: { sent: false, gone: true }, error: null })

      const updateMock = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        if (table === 'students' /* update call */) return updateMock
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.approveDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin')
      await flushMicrotasks()

      // Stale token must be cleared
      expect(mocks.from).toHaveBeenCalledWith('students')
    })

    it('does not send push when RPC returns an error', async () => {
      mocks.rpc.mockResolvedValue({ data: { error: 'not_found' }, error: null })

      await api.approveDeparture('nonexistent-dep', 'admin')
      await flushMicrotasks()

      expect(mocks.invoke).not.toHaveBeenCalled()
    })

    it('does not send push when student has no push_token', async () => {
      mocks.rpc.mockResolvedValue({
        data: { id: SHILO_MEIR_DEPARTURE_ID, status: 'APPROVED' },
        error: null,
      })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: null })
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.approveDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin')
      await flushMicrotasks()

      expect(mocks.invoke).not.toHaveBeenCalled()
    })
  })

  // ── Rejection push ─────────────────────────────────────────────────────────

  describe('rejectDeparture → _sendRejectionPush', () => {
    it('sends the rejection push to the student with the admin note', async () => {
      mocks.rpc.mockResolvedValue({ data: { status: 'REJECTED' }, error: null })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        throw new Error(`Unexpected table: ${table}`)
      })

      await expect(
        api.rejectDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin', 'ADMIN', 'נא לגשת קודם למשרד'),
      ).resolves.toEqual({ status: 'REJECTED' })

      expect(mocks.invoke).toHaveBeenCalledWith('send-push', {
        body: {
          subscription: SHILO_MEIR_PUSH_TOKEN,
          title: 'בקשת היציאה החריגה נדחתה',
          body: 'נא לגשת קודם למשרד',
        },
      })
    })

    it('uses default body when no admin note is provided on rejection', async () => {
      mocks.rpc.mockResolvedValue({ data: { status: 'REJECTED' }, error: null })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.rejectDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin', 'ADMIN')

      expect(mocks.invoke).toHaveBeenCalledWith('send-push', {
        body: {
          subscription: SHILO_MEIR_PUSH_TOKEN,
          title: 'בקשת היציאה החריגה נדחתה',
          body: 'הבקשה שלך נדחתה על ידי הנהלת הישיבה',
        },
      })
    })

    it('clears stale push_token when rejection push gets gone response', async () => {
      mocks.rpc.mockResolvedValue({ data: { status: 'REJECTED' }, error: null })
      mocks.invoke.mockResolvedValue({ data: { sent: false, gone: true }, error: null })

      const updateMock = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) }
      let studentsCallCount = 0
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') {
          studentsCallCount++
          // First call = SELECT push_token, second call = UPDATE push_token = null
          return studentsCallCount === 1
            ? singleResult({ push_token: SHILO_MEIR_PUSH_TOKEN })
            : updateMock
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.rejectDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin', 'ADMIN')

      expect(updateMock.update).toHaveBeenCalledWith({ push_token: null })
      expect(updateMock.eq).toHaveBeenCalledWith('id', SHILO_MEIR_STUDENT_ID)
    })

    it('does not send push when student has no push_token', async () => {
      mocks.rpc.mockResolvedValue({ data: { status: 'REJECTED' }, error: null })
      mocks.from.mockImplementation((table: string) => {
        if (table === 'departures') return singleResult({ student_id: SHILO_MEIR_STUDENT_ID })
        if (table === 'students') return singleResult({ push_token: null })
        throw new Error(`Unexpected table: ${table}`)
      })

      await api.rejectDeparture(SHILO_MEIR_DEPARTURE_ID, 'admin', 'ADMIN')

      expect(mocks.invoke).not.toHaveBeenCalled()
    })
  })
})
