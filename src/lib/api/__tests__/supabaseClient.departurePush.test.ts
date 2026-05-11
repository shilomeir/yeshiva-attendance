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

function singleResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('SupabaseApiClient departure rejection push', () => {
  const api = new SupabaseApiClient()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the rejected departure push to the student with the admin note', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'REJECTED' }, error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'departures') return singleResult({ student_id: 'student-1' })
      if (table === 'students') return singleResult({ push_token: '{"endpoint":"student-device"}' })
      throw new Error(`Unexpected table ${table}`)
    })

    await expect(
      api.rejectDeparture('departure-1', 'admin', 'ADMIN', 'נא לגשת קודם למשרד'),
    ).resolves.toEqual({ status: 'REJECTED' })

    expect(mocks.invoke).toHaveBeenCalledWith('send-push', {
      body: {
        subscription: '{"endpoint":"student-device"}',
        title: 'בקשת היציאה החריגה נדחתה',
        body: 'נא לגשת קודם למשרד',
      },
    })
  })
})
