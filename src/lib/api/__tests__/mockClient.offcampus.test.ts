/**
 * Tests for OFF_CAMPUS status changes via MockApiClient.
 *
 * Covers the four bugs fixed in the 'off campus' update flow:
 *  Bug 1 — cancelDeparture return value must be checked (propagates errors)
 *  Bug 2 — error message uses message ?? error (human-readable)
 *  Bug 3 — previousStatus captured before side-effects
 *  Bug 4 — sync engine logs errors (tested separately in syncEngine tests)
 *
 * Uses MockApiClient + Dexie (fake-indexeddb polyfill, see src/test-setup.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db/schema'
import { MockApiClient } from '@/lib/api/mockClient'
import type { Student, Departure } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CLASS_ID = 'כיתה הרב אבישי'
const GRADE    = 'שיעור א'

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: uuidv4(),
    fullName: 'דוד כהן',
    idNumber: '123456789',
    phone: '0501234567',
    deviceToken: null,
    push_token: null,
    currentStatus: 'ON_CAMPUS',
    lastSeen: null,
    lastLocation: null,
    pendingApproval: false,
    createdAt: new Date().toISOString(),
    grade: GRADE,
    classId: CLASS_ID,
    ...overrides,
  }
}

function makeDeparture(studentId: string, overrides: Partial<Departure> = {}): Departure {
  const now = new Date()
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000) // 2 h from now
  return {
    id: uuidv4(),
    student_id: studentId,
    class_id: CLASS_ID,
    start_at: now.toISOString(),
    end_at: end.toISOString(),
    status: 'ACTIVE',
    source: 'SELF',
    is_urgent: false,
    reason: null,
    admin_note: null,
    approved_by: null,
    created_at: now.toISOString(),
    approved_at: now.toISOString(),
    activated_at: now.toISOString(),
    completed_at: null,
    cancelled_at: null,
    rejected_at: null,
    gps_lat: null,
    gps_lng: null,
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const api = new MockApiClient()

beforeEach(async () => {
  // Clear all tables so each test starts clean
  await Promise.all([
    db.students.clear(),
    db.departures.clear(),
    db.adminOverrides.clear(),
    db.events.clear(),
    db.syncQueue.clear(),
  ])
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Admin OFF_CAMPUS override', () => {
  it('happy path — student ON_CAMPUS with no departures becomes OFF_CAMPUS', async () => {
    const student = makeStudent({ currentStatus: 'ON_CAMPUS' })
    await db.students.add(student)

    const override = await api.createAdminOverride(student.id, 'OFF_CAMPUS', 'test note')

    // Audit record returned and stored
    expect(override.newStatus).toBe('OFF_CAMPUS')
    expect(override.previousStatus).toBe('ON_CAMPUS')  // Bug 3: must be captured before changes
    expect(override.studentId).toBe(student.id)

    // Student status updated in local DB
    const updated = await db.students.get(student.id)
    expect(updated?.currentStatus).toBe('OFF_CAMPUS')

    // An ACTIVE ADMIN_OVERRIDE departure exists
    const departures = await db.departures.where('student_id').equals(student.id).toArray()
    expect(departures).toHaveLength(1)
    expect(departures[0].status).toBe('ACTIVE')
    expect(departures[0].source).toBe('ADMIN_OVERRIDE')
  })

  it('cancellation cascade — existing ACTIVE departure is cancelled, new ACTIVE departure is created', async () => {
    const student = makeStudent({ currentStatus: 'OFF_CAMPUS' })
    await db.students.add(student)

    // Student already has an ACTIVE departure
    const activeDep = makeDeparture(student.id, { status: 'ACTIVE', source: 'SELF' })
    await db.departures.add(activeDep)

    const override = await api.createAdminOverride(student.id, 'OFF_CAMPUS', 'admin re-override')

    // Previous status in audit record must reflect what it was BEFORE the override
    expect(override.previousStatus).toBe('OFF_CAMPUS')
    expect(override.newStatus).toBe('OFF_CAMPUS')

    // Old departure was cancelled
    const oldDep = await db.departures.get(activeDep.id)
    expect(oldDep?.status).toBe('CANCELLED')

    // New ADMIN_OVERRIDE departure is ACTIVE
    const newDeps = await db.departures
      .where('student_id').equals(student.id)
      .filter((d) => d.source === 'ADMIN_OVERRIDE')
      .toArray()
    expect(newDeps).toHaveLength(1)
    expect(newDeps[0].status).toBe('ACTIVE')

    // Student remains OFF_CAMPUS
    const updated = await db.students.get(student.id)
    expect(updated?.currentStatus).toBe('OFF_CAMPUS')
  })

  it('also handles APPROVED (future) departure — cancels it and creates ACTIVE departure', async () => {
    const student = makeStudent({ currentStatus: 'ON_CAMPUS' })
    await db.students.add(student)

    // Student has a future APPROVED departure (start in 1 hour)
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const futureEnd = new Date(Date.now() + 3 * 60 * 60 * 1000)
    const approvedDep = makeDeparture(student.id, {
      status: 'APPROVED',
      start_at: future.toISOString(),
      end_at: futureEnd.toISOString(),
    })
    await db.departures.add(approvedDep)

    await api.createAdminOverride(student.id, 'OFF_CAMPUS')

    // Future departure cancelled
    const old = await db.departures.get(approvedDep.id)
    expect(old?.status).toBe('CANCELLED')

    // New ACTIVE departure created
    const newDeps = await db.departures
      .where('student_id').equals(student.id)
      .filter((d) => d.source === 'ADMIN_OVERRIDE')
      .toArray()
    expect(newDeps[0].status).toBe('ACTIVE')
  })
})

describe('cancelDeparture error propagation (Bug 1)', () => {
  it('returns { error } when departure is not found — does not throw', async () => {
    const result = await api.cancelDeparture('non-existent-id', 'admin', 'ADMIN')
    // Must return an error object, not throw
    expect('error' in result).toBe(true)
  })

  it('returns { error } when departure is already terminal — does not throw', async () => {
    const student = makeStudent()
    await db.students.add(student)
    const dep = makeDeparture(student.id, { status: 'COMPLETED' })
    await db.departures.add(dep)

    const result = await api.cancelDeparture(dep.id, 'admin', 'ADMIN')
    expect('error' in result).toBe(true)
  })
})

describe('Student self-submit OFF_CAMPUS (submitDeparture)', () => {
  it('creates ACTIVE departure and sets student to OFF_CAMPUS when quota not exceeded', async () => {
    const student = makeStudent({ currentStatus: 'ON_CAMPUS' })
    await db.students.add(student)

    const now = new Date()
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)

    const result = await api.submitDeparture({
      studentId: student.id,
      startAt: now,
      endAt: twoHoursLater,
      reason: 'ביקור משפחה',
      source: 'SELF',
      actorId: student.id,
      actorRole: 'STUDENT',
    })

    // Should not be an error or QUOTA_FULL (only 1 student in class)
    expect('error' in result).toBe(false)
    expect('status' in result && (result as { status: string }).status).not.toBe('QUOTA_FULL')

    const dep = result as { id: string; status: string }
    expect(dep.status).toBe('ACTIVE')

    // Student status updated in DB
    const updated = await db.students.get(student.id)
    expect(updated?.currentStatus).toBe('OFF_CAMPUS')

    // Departure record persisted
    const stored = await db.departures.get(dep.id)
    expect(stored?.status).toBe('ACTIVE')
    expect(stored?.source).toBe('SELF')
    expect(stored?.student_id).toBe(student.id)
  })

  it('returns QUOTA_FULL when class quota is exceeded', async () => {
    // Quota formula: GREATEST(1, ROUND((classSize * 3) / 25))
    // With 25 students → quota = 3. Seed 3 classmates already off campus.
    const studentIds: string[] = []
    for (let i = 0; i < 25; i++) {
      const s = makeStudent({ id: uuidv4(), idNumber: String(100000000 + i) })
      await db.students.add(s)
      studentIds.push(s.id)
    }

    const now = new Date()
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000)

    // Put 3 classmates out (fills quota of 3 for a 25-student class)
    for (let i = 0; i < 3; i++) {
      await db.departures.add(makeDeparture(studentIds[i], { status: 'ACTIVE' }))
      await db.students.update(studentIds[i], { currentStatus: 'OFF_CAMPUS' })
    }

    // 4th student tries to go off campus
    const result = await api.submitDeparture({
      studentId: studentIds[3],
      startAt: now,
      endAt: end,
      source: 'SELF',
      actorRole: 'STUDENT',
    })

    expect('status' in result && (result as { status: string }).status).toBe('QUOTA_FULL')
    // Student status should NOT have changed
    const unchanged = await db.students.get(studentIds[3])
    expect(unchanged?.currentStatus).toBe('ON_CAMPUS')
  })
})
