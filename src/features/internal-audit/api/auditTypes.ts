// Type definitions for the Internal Audit feature.
// Mirrors the schema in supabase/migrations/20260527_internal_audit.sql.

export type AuditSessionMode = 'LOCATION' | 'MANUAL'

export type AuditSessionStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'CLOSING'
  | 'COMPLETED'
  | 'CANCELLED'

export interface AuditSession {
  id: string
  mode: AuditSessionMode
  status: AuditSessionStatus
  title: string
  started_by: string
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
  notes: string | null
  projection_enabled: boolean
  threshold_meters: number
  include_approved_departures: boolean
  summary: AuditSummary | null
}

export interface AuditSessionClass {
  id: string
  session_id: string
  grade: string
  class_id: string
  created_at: string
}

export type AuditExpectedState = 'EXPECTED_ON_CAMPUS' | 'APPROVED_OUTSIDE'

export interface AuditParticipant {
  id: string
  session_id: string
  student_id: string
  student_name: string
  id_number: string
  grade: string
  class_id: string
  baseline_status: string
  approved_departure_id: string | null
  approved_departure_label: string | null
  expected_state: AuditExpectedState
  created_at: string
}

export type AuditLocationResponseStatus =
  | 'PENDING'
  | 'REQUEST_SENT'
  | 'APP_OPENED'
  | 'GRANTED'
  | 'DENIED_BY_USER'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'LOW_ACCURACY'
  | 'FAILED'

export type AuditLocationClass =
  | 'ON_CAMPUS'
  | 'NEAR_CAMPUS'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN'

export interface AuditLocationResponse {
  id: string
  session_id: string
  student_id: string
  status: AuditLocationResponseStatus
  lat: number | null
  lng: number | null
  accuracy_meters: number | null
  distance_from_campus_meters: number | null
  location_class: AuditLocationClass | null
  captured_at: string | null
  created_at: string
  updated_at: string
  error_message: string | null
  device_meta: Record<string, unknown> | null
}

export type AuditManualMarkStatus =
  | 'PRESENT'
  | 'OUTSIDE_APPROVED'
  | 'OUTSIDE_UNAPPROVED'

export interface AuditManualMark {
  id: string
  session_id: string
  student_id: string
  class_id: string
  marked_by: string
  marked_by_role: 'SUPERVISOR' | 'ADMIN'
  status: AuditManualMarkStatus
  note: string | null
  created_at: string
  updated_at: string
}

export type AuditAlertType =
  | 'OUT_OF_RANGE'
  | 'NO_RESPONSE'
  | 'LOCATION_DENIED'
  | 'LOCATION_FAILED'
  | 'MANUAL_OUTSIDE_UNAPPROVED'
  | 'LOW_ACCURACY'

export type AuditAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AuditAlert {
  id: string
  session_id: string
  student_id: string
  type: AuditAlertType
  severity: AuditAlertSeverity
  message: string
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

// Row returned by v_audit_live_board (admin view)
export interface AuditLiveBoardRow {
  session_id: string
  participant_id: string
  student_id: string
  student_name: string
  id_number: string
  grade: string
  class_id: string
  expected_state: AuditExpectedState
  approved_departure_id: string | null
  approved_departure_label: string | null
  location_status: AuditLocationResponseStatus | null
  lat: number | null
  lng: number | null
  accuracy_meters: number | null
  distance_from_campus_meters: number | null
  location_class: AuditLocationClass | null
  captured_at: string | null
  error_message: string | null
  manual_status: AuditManualMarkStatus | null
  manual_marked_by: string | null
  manual_marked_by_role: 'SUPERVISOR' | 'ADMIN' | null
  manual_note: string | null
  manual_updated_at: string | null
  open_alert_type: AuditAlertType | null
  open_alert_severity: AuditAlertSeverity | null
}

// Row returned by v_audit_class_board (supervisor view, no lat/lng)
export type AuditClassBoardRow = Omit<
  AuditLiveBoardRow,
  | 'lat'
  | 'lng'
  | 'accuracy_meters'
  | 'distance_from_campus_meters'
  | 'error_message'
  | 'manual_marked_by'
  | 'manual_marked_by_role'
  | 'open_alert_type'
  | 'open_alert_severity'
>

export interface AuditSummary {
  totalParticipants: number
  totalClasses: number
  approvedOutside: number
  onCampusByLocation: number
  outOfRange: number
  manualPresent: number
  manualOutsideApproved: number
  manualOutsideUnapproved: number
  noResponse: number
  criticalAlerts: number
  warningAlerts: number
}

// History row from v_audit_history
export interface AuditHistoryRow {
  id: string
  mode: AuditSessionMode
  status: AuditSessionStatus
  title: string
  started_by: string
  started_at: string | null
  ended_at: string | null
  created_at: string
  threshold_meters: number
  summary: AuditSummary | null
  duration_seconds: number
  participants_count: number
  classes_count: number
  critical_count: number
}

export interface CreateAuditSessionInput {
  mode: AuditSessionMode
  classIds: string[]
  title?: string
  startedBy?: string
}

export interface CreateAuditSessionResult {
  sessionId: string
  participants: number
  classes: number
  reused: boolean
}

export interface RecordLocationResponseInput {
  sessionId: string
  studentId: string
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  gpsStatus: 'GRANTED' | 'DENIED_BY_USER' | 'UNAVAILABLE' | 'TIMEOUT' | 'FAILED'
  errorMessage?: string | null
  deviceMeta?: Record<string, unknown> | null
}

export interface RecordLocationResponseResult {
  ok: true
  status: AuditLocationResponseStatus
  locationClass: AuditLocationClass
  distance: number | null
}

export interface ManualMarkInput {
  sessionId: string
  studentId: string
  status: AuditManualMarkStatus
  markedBy: string
  markedByRole?: 'SUPERVISOR' | 'ADMIN'
  note?: string | null
}
