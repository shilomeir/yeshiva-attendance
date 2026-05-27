import { describe, it, expect } from 'vitest'
import { deriveAuditStudentStatus, getMetricBucket, deriveFromRow } from '../auditStatus'
import { computeMetrics, groupByClass } from '../auditSummary'
import type { AuditLiveBoardRow } from '../../api/auditTypes'

describe('deriveAuditStudentStatus', () => {
  it('approved departure wins regardless of distance', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'APPROVED_OUTSIDE',
        locationStatus: 'GRANTED',
        locationClass: 'OUT_OF_RANGE',
        manualStatus: null,
        hasApprovedDeparture: true,
      }),
    ).toBe('APPROVED_OUTSIDE')
  })

  it('GPS within range marks on campus', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'GRANTED',
        locationClass: 'ON_CAMPUS',
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('ON_CAMPUS_BY_LOCATION')
  })

  it('GPS NEAR_CAMPUS is still treated as on campus (within 5km threshold)', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'GRANTED',
        locationClass: 'NEAR_CAMPUS',
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('ON_CAMPUS_BY_LOCATION')
  })

  it('GPS OUT_OF_RANGE without approval = critical', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'GRANTED',
        locationClass: 'OUT_OF_RANGE',
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('OUT_OF_RANGE')
  })

  it('denied permission → needs supervisor', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'DENIED_BY_USER',
        locationClass: null,
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('NEEDS_SUPERVISOR')
  })

  it('supervisor PRESENT resolves missing GPS', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'UNAVAILABLE',
        locationClass: null,
        manualStatus: 'PRESENT',
        hasApprovedDeparture: false,
      }),
    ).toBe('PRESENT_BY_SUPERVISOR')
  })

  it('supervisor OUTSIDE_UNAPPROVED is critical', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: null,
        locationClass: null,
        manualStatus: 'OUTSIDE_UNAPPROVED',
        hasApprovedDeparture: false,
      }),
    ).toBe('OUTSIDE_UNAPPROVED_BY_SUPERVISOR')
  })

  it('LOW_ACCURACY → low confidence', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'LOW_ACCURACY',
        locationClass: 'ON_CAMPUS',
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('LOW_CONFIDENCE')
  })

  it('no response yet → pending', () => {
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: null,
        locationClass: null,
        manualStatus: null,
        hasApprovedDeparture: false,
      }),
    ).toBe('PENDING_LOCATION')
  })

  it('manual mark overrides GPS readings (admin correction)', () => {
    // Student had OUT_OF_RANGE GPS but supervisor confirmed PRESENT
    expect(
      deriveAuditStudentStatus({
        expectedState: 'EXPECTED_ON_CAMPUS',
        locationStatus: 'GRANTED',
        locationClass: 'OUT_OF_RANGE',
        manualStatus: 'PRESENT',
        hasApprovedDeparture: false,
      }),
    ).toBe('PRESENT_BY_SUPERVISOR')
  })
})

describe('getMetricBucket', () => {
  it('groups statuses into the metric strip buckets', () => {
    expect(getMetricBucket('APPROVED_OUTSIDE')).toBe('approvedOutside')
    expect(getMetricBucket('ON_CAMPUS_BY_LOCATION')).toBe('onCampus')
    expect(getMetricBucket('PRESENT_BY_SUPERVISOR')).toBe('onCampus')
    expect(getMetricBucket('OUT_OF_RANGE')).toBe('exceptions')
    expect(getMetricBucket('OUTSIDE_UNAPPROVED_BY_SUPERVISOR')).toBe('exceptions')
    expect(getMetricBucket('NEEDS_SUPERVISOR')).toBe('needsSupervisor')
    expect(getMetricBucket('LOW_CONFIDENCE')).toBe('needsSupervisor')
    expect(getMetricBucket('PENDING_LOCATION')).toBe('pending')
  })
})

function makeRow(overrides: Partial<AuditLiveBoardRow>): AuditLiveBoardRow {
  return {
    session_id: 's',
    participant_id: 'p',
    student_id: 'stud',
    student_name: 'תלמיד',
    id_number: '000000000',
    grade: 'שיעור א',
    class_id: 'כיתה הרב אבישי',
    expected_state: 'EXPECTED_ON_CAMPUS',
    approved_departure_id: null,
    approved_departure_label: null,
    location_status: null,
    lat: null, lng: null, accuracy_meters: null,
    distance_from_campus_meters: null,
    location_class: null,
    captured_at: null,
    error_message: null,
    manual_status: null,
    manual_marked_by: null,
    manual_marked_by_role: null,
    manual_note: null,
    manual_updated_at: null,
    open_alert_type: null,
    open_alert_severity: null,
    ...overrides,
  }
}

describe('computeMetrics', () => {
  it('counts each bucket and computes completion %', () => {
    const rows: AuditLiveBoardRow[] = [
      makeRow({ student_id: 'a', expected_state: 'APPROVED_OUTSIDE', approved_departure_id: 'd1' }),
      makeRow({ student_id: 'b', location_status: 'GRANTED', location_class: 'ON_CAMPUS' }),
      makeRow({ student_id: 'c', location_status: 'GRANTED', location_class: 'OUT_OF_RANGE' }),
      makeRow({ student_id: 'd', location_status: 'DENIED_BY_USER' }),
      makeRow({ student_id: 'e', location_status: null }),  // pending
    ]
    const m = computeMetrics(rows)
    expect(m.total).toBe(5)
    expect(m.approvedOutside).toBe(1)
    expect(m.onCampus).toBe(1)
    expect(m.exceptions).toBe(1)
    expect(m.needsSupervisor).toBe(1)
    expect(m.pending).toBe(1)
    expect(m.checked).toBe(4)
    expect(m.completionPct).toBe(80)
  })
})

describe('groupByClass', () => {
  it('groups rows by class_id and computes per-class completion', () => {
    const rows: AuditLiveBoardRow[] = [
      makeRow({ student_id: 'a', class_id: 'A', location_status: 'GRANTED', location_class: 'ON_CAMPUS' }),
      makeRow({ student_id: 'b', class_id: 'A', location_status: null }),
      makeRow({ student_id: 'c', class_id: 'B', location_status: 'GRANTED', location_class: 'OUT_OF_RANGE' }),
    ]
    const groups = groupByClass(rows)
    expect(groups).toHaveLength(2)
    const a = groups.find(g => g.classId === 'A')!
    expect(a.total).toBe(2)
    expect(a.onCampus).toBe(1)
    expect(a.pending).toBe(1)
    expect(a.completionPct).toBe(50)
    const b = groups.find(g => g.classId === 'B')!
    expect(b.exceptions).toBe(1)
    expect(b.completionPct).toBe(100)
  })
})

describe('deriveFromRow', () => {
  it('translates a live-board row into a derived status', () => {
    const row = makeRow({ approved_departure_id: 'd1', expected_state: 'APPROVED_OUTSIDE' })
    expect(deriveFromRow(row)).toBe('APPROVED_OUTSIDE')
  })
})
