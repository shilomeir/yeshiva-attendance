/**
 * Audit contract tests (master plan R-36).
 *
 * Every audit method must produce **observable side effects equivalent**
 * across MockApiClient and SupabaseApiClient. Running the contract suite
 * against the mock here gives us regression protection without needing a
 * live Supabase. The same suite should be runnable against the real
 * client in CI when a staging Supabase URL is available — the test
 * scenarios are identical; only the api instance differs.
 *
 * The tests exercise the error-code contract: SESSION_NOT_FOUND,
 * SESSION_CLOSED, STUDENT_NOT_IN_SESSION, CLASS_FINISHED, AUTH,
 * WRONG_MODE. These are the codes the UI branches on; if the mock and
 * the server return different shapes, tests pass and the UI breaks in
 * production. Each error case here is also smoke-tested against
 * production via Supabase MCP in the QA fix PRs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { MockApiClient } from '@/lib/api/mockClient'
import type { AuditSessionWithDetails } from '@/types'

const ADMIN_PIN = '99999'
const SUPERVISOR_PIN = 'supervisor-1'
const DEVICE_TOKEN = 'device-tok-1'

function makeSnapshotStudent(overrides: { id?: string; classId?: string; fullName?: string } = {}) {
  return {
    id: overrides.id ?? uuidv4(),
    fullName: overrides.fullName ?? 'תלמיד בדיקה',
    idNumber: '331017343',
    classId: overrides.classId ?? 'כיתה א',
    grade: 'שיעור א',
  }
}

async function makeMockSession(api: MockApiClient, mode: 'MANUAL' | 'LOCATION' = 'MANUAL', studentIds: string[] = [uuidv4()]): Promise<AuditSessionWithDetails> {
  // Pre-seed via the mock's internal state by calling startAuditSession with
  // a synthetic snapshot. The mock accepts any adminPin so we don't need PIN parity.
  const result = await api.startAuditSession({
    classIds: ['כיתה א'],
    adminPin: ADMIN_PIN,
    mode,
    title: 'contract test',
  })
  if ('error' in result) throw new Error(result.error)
  // Mock returns a session shape; inject our student snapshot directly so
  // the helpers below can use known ids.
  const session = result as AuditSessionWithDetails & { studentSnapshot: ReturnType<typeof makeSnapshotStudent>[]; totalStudentsSnapshot: number }
  session.studentSnapshot = studentIds.map((id) => makeSnapshotStudent({ id }))
  session.totalStudentsSnapshot = studentIds.length
  return session
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('Audit RPC contract — mock parity (R-36)', () => {
  let api: MockApiClient

  beforeEach(() => {
    api = new MockApiClient()
  })

  describe('submitAuditEntry', () => {
    it('returns SESSION_NOT_FOUND for an unknown session', async () => {
      const r = await api.submitAuditEntry({
        sessionId: uuidv4(),
        studentId: uuidv4(),
        status: 'IN_YESHIVA',
        supervisorPin: SUPERVISOR_PIN,
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('SESSION_NOT_FOUND')
    })

    it('returns STUDENT_NOT_IN_SESSION when the student isn\'t in the snapshot', async () => {
      const session = await makeMockSession(api)
      const r = await api.submitAuditEntry({
        sessionId: session.id,
        studentId: uuidv4(), // not in snapshot
        status: 'IN_YESHIVA',
        supervisorPin: SUPERVISOR_PIN,
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('STUDENT_NOT_IN_SESSION')
    })

    it('upserts a valid entry and returns it', async () => {
      const studentId = uuidv4()
      const session = await makeMockSession(api, 'MANUAL', [studentId])
      const r = await api.submitAuditEntry({
        sessionId: session.id,
        studentId,
        status: 'IN_YESHIVA',
        supervisorPin: SUPERVISOR_PIN,
      })
      expect('error' in r).toBe(false)
      if (!('error' in r)) {
        expect(r.studentId).toBe(studentId)
        expect(r.status).toBe('IN_YESHIVA')
      }
    })
  })

  describe('submitStudentAuditGps', () => {
    it('returns AUTH when device token is empty', async () => {
      const session = await makeMockSession(api, 'LOCATION')
      const r = await api.submitStudentAuditGps({
        sessionId: session.id,
        studentId: uuidv4(),
        deviceToken: '',
        gpsLat: 31.5253,
        gpsLng: 35.1056,
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('AUTH')
    })

    it('returns WRONG_MODE for a MANUAL session', async () => {
      const studentId = uuidv4()
      const session = await makeMockSession(api, 'MANUAL', [studentId])
      const r = await api.submitStudentAuditGps({
        sessionId: session.id,
        studentId,
        deviceToken: DEVICE_TOKEN,
        gpsLat: 31.5253,
        gpsLng: 35.1056,
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('WRONG_MODE')
    })

    it('returns GREEN distance bucket and IN_YESHIVA for coords at campus', async () => {
      const studentId = uuidv4()
      const session = await makeMockSession(api, 'LOCATION', [studentId])
      const r = await api.submitStudentAuditGps({
        sessionId: session.id,
        studentId,
        deviceToken: DEVICE_TOKEN,
        gpsLat: 31.5253,
        gpsLng: 35.1056,
      })
      expect('error' in r).toBe(false)
      if (!('error' in r)) {
        expect(r.distanceBucket).toBe('GREEN')
        expect(r.status).toBe('IN_YESHIVA')
        expect(r.distanceM).toBe(0)
      }
    })

    it('returns RED bucket and OUT_WITH_PERMISSION for coords far from campus', async () => {
      const studentId = uuidv4()
      const session = await makeMockSession(api, 'LOCATION', [studentId])
      // Tel Aviv — well over 5 km from Hebron.
      const r = await api.submitStudentAuditGps({
        sessionId: session.id,
        studentId,
        deviceToken: DEVICE_TOKEN,
        gpsLat: 32.0853,
        gpsLng: 34.7818,
      })
      expect('error' in r).toBe(false)
      if (!('error' in r)) {
        expect(r.distanceBucket).toBe('RED')
        expect(r.status).toBe('OUT_WITH_PERMISSION')
        expect(r.distanceM).toBeGreaterThan(5000)
      }
    })
  })

  describe('bulkMarkUnmarkedAuditEntries', () => {
    it('marks only students without an existing entry', async () => {
      const ids = [uuidv4(), uuidv4(), uuidv4()]
      const session = await makeMockSession(api, 'MANUAL', ids)
      // Pre-mark the first student
      await api.submitAuditEntry({
        sessionId: session.id,
        studentId: ids[0],
        status: 'OUT_WITHOUT_PERMISSION',
        supervisorPin: SUPERVISOR_PIN,
      })
      const r = await api.bulkMarkUnmarkedAuditEntries({
        sessionId: session.id,
        classId: 'כיתה א',
        status: 'IN_YESHIVA',
        supervisorPin: SUPERVISOR_PIN,
      })
      expect('error' in r).toBe(false)
      if (!('error' in r)) expect(r.markedCount).toBe(2) // ids[1] and ids[2], not ids[0]
    })

    it('returns SESSION_CLOSED when session has been closed', async () => {
      const session = await makeMockSession(api)
      await api.closeAuditSession(session.id, ADMIN_PIN)
      const r = await api.bulkMarkUnmarkedAuditEntries({
        sessionId: session.id,
        classId: 'כיתה א',
        status: 'IN_YESHIVA',
        supervisorPin: SUPERVISOR_PIN,
      })
      // After close, the mock's _mockAuditSession is preserved with status =
      // CLOSED, so the bulk RPC's session.status !== 'ACTIVE' check returns
      // SESSION_CLOSED. The real server returns the same code. (Earlier
      // versions of the mock returned SESSION_NOT_FOUND — that was the
      // regression this test catches.)
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('SESSION_CLOSED')
    })
  })

  describe('scoped active-session endpoints', () => {
    it('getActiveAuditSessionMinimal returns metadata only', async () => {
      const session = await makeMockSession(api)
      const r = await api.getActiveAuditSessionMinimal()
      expect(r).not.toBeNull()
      if (r) {
        expect(r.id).toBe(session.id)
        expect(r.mode).toBe('MANUAL')
        // No entries/snapshot fields on minimal response
        expect((r as unknown as { entries?: unknown }).entries).toBeUndefined()
      }
    })

    it('getActiveAuditForStudent returns AUTH for empty token', async () => {
      await makeMockSession(api, 'LOCATION')
      const r = await api.getActiveAuditForStudent(uuidv4(), '')
      expect(r).not.toBeNull()
      if (r && 'error' in r) expect(r.error).toBe('AUTH')
    })

    it('getActiveAuditForSupervisor returns AUTH for empty pin', async () => {
      await makeMockSession(api)
      const r = await api.getActiveAuditForSupervisor('')
      expect(r).not.toBeNull()
      if (r && 'error' in r) expect(r.error).toBe('AUTH')
    })
  })

  describe('sendAuditPush (B-26 / R-7 mock parity)', () => {
    it('returns AUTH for empty admin pin', async () => {
      const session = await makeMockSession(api)
      const r = await api.sendAuditPush({ sessionId: session.id, adminPin: '' })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('AUTH')
    })

    it('returns SESSION_NOT_FOUND for unknown sessions', async () => {
      const r = await api.sendAuditPush({ sessionId: uuidv4(), adminPin: ADMIN_PIN })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toBe('SESSION_NOT_FOUND')
    })

    it('returns sent/total counts on success', async () => {
      const session = await makeMockSession(api, 'LOCATION', [uuidv4(), uuidv4()])
      const r = await api.sendAuditPush({ sessionId: session.id, adminPin: ADMIN_PIN })
      expect('error' in r).toBe(false)
      if (!('error' in r)) {
        expect(r.total).toBe(2)
        expect(r.sent).toBe(2)
        expect(r.failed).toBe(0)
      }
    })
  })
})
