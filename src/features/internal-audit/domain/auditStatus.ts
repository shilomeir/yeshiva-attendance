import type {
  AuditLiveBoardRow,
  AuditExpectedState,
  AuditLocationResponseStatus,
  AuditLocationClass,
  AuditManualMarkStatus,
} from '../api/auditTypes'

// Derived per-student status. The UI never reasons about raw fields — it asks
// `deriveAuditStudentStatus()` for a single normalized enum.
export type AuditDerivedStatus =
  | 'APPROVED_OUTSIDE'                // Student has an active approved departure
  | 'ON_CAMPUS_BY_LOCATION'           // GPS within threshold
  | 'OUT_OF_RANGE'                    // GPS beyond threshold AND no approval (critical)
  | 'LOW_CONFIDENCE'                  // GPS arrived but accuracy is poor
  | 'PENDING_LOCATION'                // Push sent / app opened, but no GPS yet
  | 'NEEDS_SUPERVISOR'                // GPS failed/denied/unavailable, no manual mark
  | 'PRESENT_BY_SUPERVISOR'           // Supervisor confirmed PRESENT
  | 'OUTSIDE_APPROVED_BY_SUPERVISOR'  // Supervisor: outside with approval
  | 'OUTSIDE_UNAPPROVED_BY_SUPERVISOR' // Supervisor: outside without approval (critical)

export interface DeriveInputs {
  expectedState: AuditExpectedState
  locationStatus: AuditLocationResponseStatus | null
  locationClass: AuditLocationClass | null
  manualStatus: AuditManualMarkStatus | null
  hasApprovedDeparture: boolean
}

/**
 * Single domain function — the entire UI consults this to decide colour/label.
 * Priority rules (from spec §6):
 *   1. Active approved departure beats distance.
 *   2. Manual mark can resolve a missing/failed location.
 *   3. OUT_OF_RANGE without approval → critical.
 *   4. No response is not "OK" — it's "needs supervisor".
 */
export function deriveAuditStudentStatus(input: DeriveInputs): AuditDerivedStatus {
  const {
    expectedState,
    locationStatus,
    locationClass,
    manualStatus,
    hasApprovedDeparture,
  } = input

  // 1. Approved departure wins regardless of distance/responses
  if (hasApprovedDeparture || expectedState === 'APPROVED_OUTSIDE') {
    return 'APPROVED_OUTSIDE'
  }

  // 2. Manual mark takes precedence over location signals
  if (manualStatus === 'OUTSIDE_UNAPPROVED') return 'OUTSIDE_UNAPPROVED_BY_SUPERVISOR'
  if (manualStatus === 'OUTSIDE_APPROVED')   return 'OUTSIDE_APPROVED_BY_SUPERVISOR'
  if (manualStatus === 'PRESENT')            return 'PRESENT_BY_SUPERVISOR'

  // 3. Location-based classification
  if (locationStatus === 'GRANTED') {
    if (locationClass === 'OUT_OF_RANGE') return 'OUT_OF_RANGE'
    return 'ON_CAMPUS_BY_LOCATION'
  }

  if (locationStatus === 'LOW_ACCURACY') {
    return 'LOW_CONFIDENCE'
  }

  // 4. Awaiting / failed states
  if (
    locationStatus === 'DENIED_BY_USER' ||
    locationStatus === 'UNAVAILABLE' ||
    locationStatus === 'TIMEOUT' ||
    locationStatus === 'FAILED'
  ) {
    return 'NEEDS_SUPERVISOR'
  }

  // PENDING / REQUEST_SENT / APP_OPENED / null
  return 'PENDING_LOCATION'
}

/** Apply derive() to a live-board row. Convenience for UI components. */
export function deriveFromRow(row: AuditLiveBoardRow): AuditDerivedStatus {
  return deriveAuditStudentStatus({
    expectedState: row.expected_state,
    locationStatus: row.location_status,
    locationClass: row.location_class,
    manualStatus: row.manual_status,
    hasApprovedDeparture: !!row.approved_departure_id,
  })
}

// Display label + colour token for each derived status.
// Components style themselves by reading these from getAuditStatusDisplay().
export interface AuditStatusDisplay {
  label: string
  tone: 'good' | 'bad' | 'warn' | 'info' | 'neutral'
  isCritical: boolean
}

const STATUS_DISPLAY: Record<AuditDerivedStatus, AuditStatusDisplay> = {
  APPROVED_OUTSIDE:                 { label: 'יציאה מאושרת',            tone: 'good',    isCritical: false },
  ON_CAMPUS_BY_LOCATION:            { label: 'נוכח (מיקום)',           tone: 'good',    isCritical: false },
  OUT_OF_RANGE:                     { label: 'חריגה — מחוץ לטווח',     tone: 'bad',     isCritical: true  },
  LOW_CONFIDENCE:                   { label: 'דיוק מיקום נמוך',         tone: 'info',    isCritical: false },
  PENDING_LOCATION:                 { label: 'ממתין למיקום',            tone: 'neutral', isCritical: false },
  NEEDS_SUPERVISOR:                 { label: 'דורש סימון רכז',          tone: 'warn',    isCritical: false },
  PRESENT_BY_SUPERVISOR:            { label: 'נוכח (סימון רכז)',        tone: 'good',    isCritical: false },
  OUTSIDE_APPROVED_BY_SUPERVISOR:   { label: 'בחוץ עם אישור (רכז)',    tone: 'good',    isCritical: false },
  OUTSIDE_UNAPPROVED_BY_SUPERVISOR: { label: 'בחוץ ללא אישור (רכז)',   tone: 'bad',     isCritical: true  },
}

export function getAuditStatusDisplay(status: AuditDerivedStatus): AuditStatusDisplay {
  return STATUS_DISPLAY[status]
}

// Bucket statuses into the metric strip categories (spec §10.5)
export type AuditMetricBucket =
  | 'checked'           // anyone whose state is determined (good / bad / warn-supervisor / approved)
  | 'onCampus'          // good
  | 'approvedOutside'   // approved departure
  | 'exceptions'        // critical (out_of_range / outside_unapproved)
  | 'needsSupervisor'   // warn — needs human input
  | 'pending'           // pending_location only

export function getMetricBucket(status: AuditDerivedStatus): AuditMetricBucket {
  switch (status) {
    case 'APPROVED_OUTSIDE':                   return 'approvedOutside'
    case 'ON_CAMPUS_BY_LOCATION':
    case 'PRESENT_BY_SUPERVISOR':              return 'onCampus'
    case 'OUTSIDE_APPROVED_BY_SUPERVISOR':     return 'approvedOutside'
    case 'OUT_OF_RANGE':
    case 'OUTSIDE_UNAPPROVED_BY_SUPERVISOR':   return 'exceptions'
    case 'NEEDS_SUPERVISOR':                   return 'needsSupervisor'
    case 'LOW_CONFIDENCE':                     return 'needsSupervisor'
    case 'PENDING_LOCATION':                   return 'pending'
  }
}

export function isResolved(status: AuditDerivedStatus): boolean {
  return status !== 'PENDING_LOCATION' && status !== 'NEEDS_SUPERVISOR' && status !== 'LOW_CONFIDENCE'
}
