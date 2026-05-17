// ─────────────────────────────────────────────────────────────────────────────
// Student & Auth types
// ─────────────────────────────────────────────────────────────────────────────

// OVERDUE kept only for reading legacy DB rows — never created by new code.
export type StudentStatus = 'ON_CAMPUS' | 'OFF_CAMPUS' | 'OVERDUE' | 'PENDING'

export type GPSStatus = 'GRANTED' | 'DENIED_BY_USER' | 'UNAVAILABLE' | 'PENDING'

export interface Student {
  id: string
  fullName: string
  idNumber: string
  phone: string
  deviceToken: string | null
  push_token: string | null  // JSON-serialized Web Push PushSubscription
  currentStatus: StudentStatus
  lastSeen: string | null
  lastLocation: { lat: number; lng: number } | null
  pendingApproval: boolean
  createdAt: string
  grade: string
  classId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Departure — the unified departure state machine
// ─────────────────────────────────────────────────────────────────────────────

/** Every live/planned departure goes through this state machine.
 *  PENDING   → APPROVED (admin approves) or REJECTED (admin rejects)
 *  APPROVED  → ACTIVE (tick_departures fires when start_at ≤ now)
 *  ACTIVE    → COMPLETED (tick or early return) | CANCELLED
 *  any non-terminal → CANCELLED
 */
export type DepartureStatus =
  | 'PENDING'    // Awaiting admin approval
  | 'APPROVED'   // Approved; not yet active (future departure)
  | 'ACTIVE'     // Student is currently outside
  | 'COMPLETED'  // Student has returned
  | 'REJECTED'   // Admin denied
  | 'CANCELLED'  // Cancelled by student or admin

/** Who initiated the departure record. */
export type DepartureSource =
  | 'SELF'           // Student submitted via the app
  | 'ADMIN_OVERRIDE' // Admin direct override (bypasses quota)
  | 'SUPERVISOR'     // Class supervisor action
  | 'SHEETS'         // Injected by Sheets sync

export interface Departure {
  id: string
  student_id: string
  class_id: string        // Denormalized at submission time
  start_at: string        // ISO TIMESTAMPTZ
  end_at: string          // ISO TIMESTAMPTZ
  status: DepartureStatus
  source: DepartureSource
  is_urgent: boolean
  reason: string | null
  admin_note: string | null
  approved_by: string | null
  created_at: string
  approved_at: string | null
  activated_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  rejected_at: string | null
  gps_lat: number | null
  gps_lng: number | null
}

/** Row returned by v_calendar_departures (Departure + joined student fields) */
export interface CalendarDeparture extends Departure {
  student_name: string
  grade: string
  /** True when ACTIVE and end_at is more than 24 h in the past (overstay alert) */
  is_overdue_alert: boolean
}

/** Result returned by submit_departure when quota is full (no row inserted) */
export interface QuotaFullResult {
  status: 'QUOTA_FULL'
  current: number
  quota: number
  overlapping: Array<{
    studentId: string
    studentName: string
    endAt: string
  }>
}

/** Result returned by submit_departure on success */
export interface DepartureSubmitResult {
  id: string
  status: DepartureStatus
  quota: number
  current: number
  /** True when a PENDING was created because quota was full and student chose force-send */
  notifyAdmin?: boolean
}

/** Union of all possible submit_departure return values */
export type SubmitDepartureResult =
  | DepartureSubmitResult
  | QuotaFullResult
  | { error: string; message?: string }

// ─────────────────────────────────────────────────────────────────────────────
// Events (immutable audit log — CHECK_IN / CHECK_OUT / OVERRIDE)
// ─────────────────────────────────────────────────────────────────────────────

export type EventType = 'CHECK_IN' | 'CHECK_OUT' | 'OVERRIDE'

export interface Event {
  id: string
  studentId: string
  type: EventType
  timestamp: string
  reason: string | null
  expectedReturn: string | null  // TIMESTAMPTZ (was TEXT — migrated in 20260423)
  gpsLat: number | null
  gpsLng: number | null
  gpsStatus: GPSStatus
  distanceFromCampus: number | null
  note: string | null
  syncedAt: string | null
  departure_id: string | null  // FK to departures (added in 20260423)
}

// ─────────────────────────────────────────────────────────────────────────────
// Other domain types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminOverride {
  id: string
  studentId: string
  adminId: string
  action: string
  previousStatus: string  // StudentStatus OR DepartureStatus for departure transitions
  newStatus: string
  timestamp: string
  note: string | null
}

export interface SyncQueueItem {
  id: string
  tableName: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC'
  payload: Record<string, unknown>
  clientTimestamp: string
  retryCount: number
  lastAttemptAt?: number  // Unix ms; undefined = never attempted
}

export interface RecurringAbsence {
  id: string
  studentId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  reason: string
  isActive: boolean
}

export interface DashboardStats {
  total: number
  onCampus: number
  offCampus: number
  pending: number
  longAbsent: number
}

export interface CampusStatusCounts {
  total: number
  onCampus: number
  offCampus: number
  pending: number
  byClass: Record<string, { total: number; onCampus: number; offCampus: number }>
}

export interface ClassStat {
  grade: string
  classId: string
  total: number
  onCampus: number
  offCampus: number
}

export interface DailyPresenceData {
  date: string
  onCampus: number
  offCampus: number
}

export interface ReasonData {
  reason: string
  count: number
}

export interface HourlyData {
  hour: number
  count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Audit Session types
// ─────────────────────────────────────────────────────────────────────────────

export type AuditSessionStatus = 'ACTIVE' | 'CLOSED' | 'TIMED_OUT' | 'ABORTED'
export type AuditSessionMode   = 'MANUAL' | 'LOCATION'
export type AuditEntryStatus   = 'IN_YESHIVA' | 'OUT_WITH_PERMISSION' | 'OUT_WITHOUT_PERMISSION'
export type AuditEntrySource   = 'SUPERVISOR' | 'AUTO_DEFAULT' | 'AUTO_GPS'
export type AuditClassStateStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'

export interface AuditStudentSnapshot {
  id: string
  fullName: string
  idNumber: string
  classId: string
  grade: string
}

export interface AuditEntry {
  id: string
  sessionId: string
  studentId: string | null
  studentSnapshotIdx: number
  classId: string
  grade: string
  status: AuditEntryStatus
  note: string | null
  source: AuditEntrySource
  hadActiveDepartureAtAudit: boolean
  submittedBy: string
  submittedAt: string
  updatedAt: string
  gpsLat?: number | null
  gpsLng?: number | null
  gpsAccuracyM?: number | null
  distanceFromCampusM?: number | null
  distanceBucket?: 'GREEN' | 'BLUE' | 'ORANGE' | 'RED' | null
  gpsStatus?: 'OK' | 'DENIED' | 'TIMEOUT' | 'OFFLINE' | 'UNAVAILABLE' | 'LOW_ACCURACY' | null
}

export interface AuditClassState {
  id: string
  sessionId: string
  classId: string
  status: AuditClassStateStatus
  startedAt: string | null
  finishedAt: string | null
  finishedBy: string | null
  unmarkedAtFinish: number | null
  inYeshivaAtFinish: number | null
  outWithPermAtFinish: number | null
  outWithoutPermAtFinish: number | null
  supervisorNote: string | null
  updatedAt: string
}

export interface AuditSession {
  id: string
  title: string | null
  mode: AuditSessionMode
  startedAt: string
  startedBy: string
  classIds: string[]
  status: AuditSessionStatus
  closedAt: string | null
  closedBy: string | null
  totalStudentsSnapshot: number
  classSnapshot: Array<{ classId: string; grade: string; studentCount: number }>
  studentSnapshot: AuditStudentSnapshot[]
  activeDeparturesSnapshot: Array<{ studentId: string; departureId: string; endAt: string; reason: string | null }>
  settings: Record<string, unknown>
}

export interface AuditSessionWithDetails extends AuditSession {
  entries: AuditEntry[]
  classStates: AuditClassState[]
}

export interface AuditSessionSummary {
  id: string
  title: string | null
  startedAt: string
  closedAt: string | null
  status: AuditSessionStatus
  classIds: string[]
  totalStudentsSnapshot: number
  inYeshivaCount: number
  outWithPermCount: number
  outWithoutPermCount: number
  markedCount: number
  unmarkedCount: number
  durationSec: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat alias — components that still import AbsenceRequest will
// continue to compile during the transition. Remove after Phase 9.
// ─────────────────────────────────────────────────────────────────────────────
export type AbsenceRequestStatus = DepartureStatus
export type AbsenceRequest = CalendarDeparture
