import type {
  Student,
  Event,
  AdminOverride,
  RecurringAbsence,
  StudentStatus,
  DashboardStats,
  CampusStatusCounts,
  DailyPresenceData,
  ReasonData,
  HourlyData,
  ClassStat,
  Departure,
  CalendarDeparture,
  DepartureStatus,
  DepartureSource,
  SubmitDepartureResult,
  AuditSessionWithDetails,
  AuditSessionSummary,
  AuditEntry,
  AuditClassState,
  AuditSessionMode,
  AuditEntryStatus,
} from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Input payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface GetStudentsOptions {
  filter?: 'ALL' | 'OFF_CAMPUS' | 'PENDING'
  search?: string
  grade?: string
  classId?: string
  limit?: number
  offset?: number
}

export interface SubmitDeparturePayload {
  studentId: string
  startAt: Date | string   // departure start (may be now or future)
  endAt: Date | string     // expected return
  reason?: string | null
  isUrgent?: boolean
  source?: DepartureSource
  approvedBy?: string | null
  forcePending?: boolean   // true = create PENDING even when quota is full
  actorId?: string | null
  actorRole?: 'STUDENT' | 'ADMIN' | 'SUPERVISOR'
  actorPin?: string | null // Required for source=ADMIN_OVERRIDE with actorRole=ADMIN
}

export interface ListDeparturesOptions {
  studentId?: string
  classId?: string
  grade?: string
  status?: DepartureStatus | DepartureStatus[]
  from?: Date | string   // start_at >= from
  to?: Date | string     // start_at <= to (or end_at >= to for calendar range)
  limit?: number
}

export interface CreateEventPayload {
  studentId: string
  type: Event['type']
  reason?: string | null
  expectedReturn?: string | null
  gpsLat?: number | null
  gpsLng?: number | null
  gpsStatus?: Event['gpsStatus']
  distanceFromCampus?: number | null
  note?: string | null
  departureId?: string | null
}

export interface PushNotificationTarget {
  grade?: string
  classId?: string
  studentIds?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic result type — avoids throw/catch in callers
// ─────────────────────────────────────────────────────────────────────────────

export type AppResult<T> =
  | { data: T; error?: never }
  | { data?: never; error: { message: string } }

// ─────────────────────────────────────────────────────────────────────────────
// Student mutation payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface AddStudentPayload {
  idNumber: string   // Must be exactly 9 digits; uniqueness enforced by DB
  fullName: string
  phone: string
  grade: string      // Must be a value from GRADE_LEVELS
  classId: string    // Must be a value from GRADE_CLASS_MAP[grade]
}

export type UpdateStudentPayload = Partial<Pick<Student, 'fullName' | 'phone' | 'grade' | 'classId'>>

// ─────────────────────────────────────────────────────────────────────────────
// Scoped active-audit response shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveAuditSessionMinimal {
  id: string
  title: string | null
  mode: AuditSessionMode
  startedAt: string
  classIds: string[]
  totalStudentsSnapshot: number
  status: 'ACTIVE'
}

export interface ActiveAuditForStudent {
  session: {
    id: string
    title: string | null
    mode: AuditSessionMode
    startedAt: string
    classIds: string[]
    status: 'ACTIVE'
  }
  isInActiveSession: boolean
  myEntry: {
    id: string
    status: AuditEntryStatus
    source: 'SUPERVISOR' | 'AUTO_DEFAULT' | 'AUTO_GPS'
    submittedAt: string
    distanceFromCampusM: number | null
    distanceBucket: 'GREEN' | 'BLUE' | 'ORANGE' | 'RED' | null
  } | null
}

export interface ActiveAuditForSupervisor {
  /** Session with snapshots filtered to the supervisor's class. shape matches
   *  AuditSessionWithDetails so existing UI code (Mission Control reuse,
   *  ClassSupervisorDashboard) can consume it identically. */
  session: AuditSessionWithDetails
  isInActiveSession: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// IApiClient — single interface for Supabase + Mock implementations
// ─────────────────────────────────────────────────────────────────────────────

export interface IApiClient {
  // ── Students ───────────────────────────────────────────────────────────────
  getStudents(options?: GetStudentsOptions): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  getStudentsByIds(ids: string[]): Promise<Record<string, Student>>
  getStudentByIdNumber(idNumber: string): Promise<Student | null>
  updateStudentStatus(id: string, status: StudentStatus): Promise<void>
  updateStudentGrade(id: string, grade: string, classId: string): Promise<void>
  updateStudentLocation(id: string, lat: number, lng: number): Promise<void>
  updateStudentFcmToken(id: string, token: string): Promise<void>
  updatePushToken(id: string, token: string | null): Promise<void>
  sendPushNotification(title: string, body: string, target?: PushNotificationTarget): Promise<{ sent: number; failed: number; lastError?: string }>
  /** Master plan R-7 / B-19: server-side batched push for LOCATION-mode audits.
   *  One HTTP call from admin → Edge Function fans out to all students in
   *  the session snapshot with concurrency cap, logs to audit_push_log,
   *  cleans up gone tokens. Returns a per-batch summary. */
  sendAuditPush(params: { sessionId: string; adminPin: string; title?: string; message?: string }): Promise<{ sent: number; failed: number; removed: number; total: number; lastError?: string } | { error: string }>
  sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }>
  /** Admin-only: add a new student from the dashboard. */
  addStudent(student: AddStudentPayload): Promise<AppResult<Student>>
  /** Admin-only: update mutable student fields. */
  updateStudent(id: string, updates: UpdateStudentPayload): Promise<AppResult<Student>>
  /** Admin-only: hard-delete student (CASCADE on departures/events). Guards against active departures. */
  deleteStudent(id: string): Promise<void>
  getClassSize(classId: string): Promise<number>
  getLongAbsentStudents(days?: number): Promise<Student[]>

  // ── Departures (unified — replaces absence_requests) ──────────────────────
  /** Single entry point for all departure submissions. */
  submitDeparture(payload: SubmitDeparturePayload): Promise<SubmitDepartureResult>

  /** Approve a PENDING departure. Returns updated status (APPROVED or ACTIVE). */
  approveDeparture(id: string, actorId: string, actorRole?: 'ADMIN' | 'SUPERVISOR', note?: string): Promise<{ status: DepartureStatus } | { error: string }>

  /** Reject a PENDING departure. */
  rejectDeparture(id: string, actorId: string, actorRole?: 'ADMIN' | 'SUPERVISOR', note?: string): Promise<{ status: 'REJECTED' } | { error: string }>

  /** Cancel any non-terminal departure. Returns student ON_CAMPUS if was ACTIVE. */
  cancelDeparture(id: string, actorId: string, actorRole?: 'STUDENT' | 'ADMIN' | 'SUPERVISOR', note?: string): Promise<{ status: 'CANCELLED' } | { error: string }>

  /** Student returns early — completes ACTIVE departure and creates CHECK_IN event. */
  returnDeparture(id: string, studentId?: string, gpsLat?: number, gpsLng?: number): Promise<{ status: 'COMPLETED' } | { error: string }>

  /** Query the v_calendar_departures view. */
  listDepartures(options?: ListDeparturesOptions): Promise<CalendarDeparture[]>

  /** Manually trigger the tick (for testing / manual dashboard refresh). */
  tickDepartures(): Promise<number>

  // ── Events (append-only audit log) ────────────────────────────────────────
  getEvents(studentId: string): Promise<Event[]>
  /** Only used for OVERRIDE events. Check-outs go through submitDeparture. */
  createEvent(payload: CreateEventPayload): Promise<Event>
  deleteEvent(id: string): Promise<void>
  getRecentEvents(limit?: number): Promise<Event[]>

  // ── Audit log ──────────────────────────────────────────────────────────────
  getAdminOverrides(): Promise<AdminOverride[]>
  /** Direct admin status override (bypasses quota, creates ADMIN_OVERRIDE departure). */
  createAdminOverride(studentId: string, newStatus: StudentStatus, note?: string): Promise<AdminOverride>

  // ── Recurring absences (read-only for now) ────────────────────────────────
  getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]>

  // ── Analytics ─────────────────────────────────────────────────────────────
  getDashboardStats(): Promise<DashboardStats>
  /** Lightweight aggregation — single DB round-trip, no full student fetch. */
  getCampusStatusCounts(): Promise<CampusStatusCounts>
  getDailyPresence(days?: number): Promise<DailyPresenceData[]>
  getReasonBreakdown(): Promise<ReasonData[]>
  getHourlyDepartures(): Promise<HourlyData[]>
  getClassStats(): Promise<ClassStat[]>

  // ── Internal Audit Session ─────────────────────────────────────────────────
  startAuditSession(params: { classIds: string[]; title?: string; adminPin: string; mode?: AuditSessionMode }): Promise<AuditSessionWithDetails | { error: string; existingId?: string }>
  /** Admin-only (authenticated role required). Returns the full active session
   *  including all snapshots, entries, notes, and GPS. Anon callers should use
   *  getActiveAuditSessionMinimal / ForStudent / ForSupervisor instead. */
  getActiveAuditSession(): Promise<AuditSessionWithDetails | null>
  /** Anon-callable. Returns session metadata only — no snapshots, no entries,
   *  no GPS. Use this to detect that an audit is happening without exposing
   *  participant data. */
  getActiveAuditSessionMinimal(): Promise<ActiveAuditSessionMinimal | null>
  /** Anon-callable, token-validated. Returns session metadata plus only this
   *  student's own entry (with their own GPS data). Other students are not
   *  exposed. Returns { error: 'AUTH' } if the device token doesn't match. */
  getActiveAuditForStudent(studentId: string, deviceToken: string): Promise<ActiveAuditForStudent | { error: string } | null>
  /** Anon-callable, PIN-validated. Returns session metadata plus the supervisor's
   *  class snapshot/entries/classState only. Admin PIN returns the full session
   *  (covers the admin-using-supervisor-view case). Returns { error: 'AUTH' }
   *  if the PIN doesn't match a supervisor or admin. */
  getActiveAuditForSupervisor(supervisorPin: string): Promise<ActiveAuditForSupervisor | { error: string } | null>
  getAuditSession(id: string): Promise<AuditSessionWithDetails | null>
  listAuditSessions(limit?: number, offset?: number): Promise<AuditSessionSummary[]>
  closeAuditSession(id: string, adminPin: string): Promise<AuditSessionWithDetails | { error: string }>
  submitAuditEntry(params: { sessionId: string; studentId: string; status: AuditEntryStatus; note?: string; supervisorPin: string }): Promise<AuditEntry | { error: string }>
  finishClassAudit(params: { sessionId: string; classId: string; note?: string; supervisorPin: string }): Promise<AuditClassState | { error: string }>
  /** Bulk-seed a status for every student in the class who doesn't yet have an
   *  entry. ON CONFLICT DO NOTHING preserves AUTO_DEFAULT seeds and prior
   *  manual marks. Returns the count of rows actually inserted. */
  bulkMarkUnmarkedAuditEntries(params: { sessionId: string; classId: string; status: AuditEntryStatus; supervisorPin: string }): Promise<{ markedCount: number } | { error: string }>
  /** Student submits their GPS location during a LOCATION-mode audit.
   *  Auth is device-token-based (no PIN). Returns distance info on success. */
  submitStudentAuditGps(params: { sessionId: string; studentId: string; deviceToken: string; gpsLat: number; gpsLng: number; accuracyM?: number | null; gpsStatus?: string }): Promise<{ distanceM: number; distanceBucket: string; status: AuditEntryStatus } | { error: string }>
}
