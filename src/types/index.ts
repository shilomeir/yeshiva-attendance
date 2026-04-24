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
  | 'SMS'            // Parsed from incoming SMS
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
// Events (immutable audit log — CHECK_IN / CHECK_OUT / OVERRIDE / SMS)
// ─────────────────────────────────────────────────────────────────────────────

export type EventType = 'CHECK_IN' | 'CHECK_OUT' | 'OVERRIDE' | 'SMS_IN' | 'SMS_OUT'

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

export interface SmsEvent {
  id: string
  studentId: string | null
  rawMessage: string
  parsedCorrectly: boolean
  parsedType: EventType | null
  parsedTime: string | null
  parsedReason: string | null
  timestamp: string
  webhookError: string | null
}

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
// Backward-compat alias — components that still import AbsenceRequest will
// continue to compile during the transition. Remove after Phase 9.
// ─────────────────────────────────────────────────────────────────────────────
export type AbsenceRequestStatus = DepartureStatus
export type AbsenceRequest = CalendarDeparture
