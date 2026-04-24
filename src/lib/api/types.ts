import type {
  Student,
  Event,
  SmsEvent,
  AdminOverride,
  RecurringAbsence,
  StudentStatus,
  DashboardStats,
  DailyPresenceData,
  ReasonData,
  HourlyData,
  ClassStat,
  Departure,
  CalendarDeparture,
  DepartureStatus,
  DepartureSource,
  SubmitDepartureResult,
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
  sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }>
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
  /** Only used for OVERRIDE / SMS events. Check-outs go through submitDeparture. */
  createEvent(payload: CreateEventPayload): Promise<Event>
  deleteEvent(id: string): Promise<void>
  getRecentEvents(limit?: number): Promise<Event[]>

  // ── SMS ────────────────────────────────────────────────────────────────────
  getSmsEvents(): Promise<SmsEvent[]>
  createSmsEvent(raw: string, studentPhone?: string): Promise<SmsEvent>

  // ── Audit log ──────────────────────────────────────────────────────────────
  getAdminOverrides(): Promise<AdminOverride[]>
  /** Direct admin status override (bypasses quota, creates ADMIN_OVERRIDE departure). */
  createAdminOverride(studentId: string, newStatus: StudentStatus, note?: string): Promise<AdminOverride>

  // ── Recurring absences (read-only for now) ────────────────────────────────
  getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]>

  // ── Analytics ─────────────────────────────────────────────────────────────
  getDashboardStats(): Promise<DashboardStats>
  getDailyPresence(days?: number): Promise<DailyPresenceData[]>
  getReasonBreakdown(): Promise<ReasonData[]>
  getHourlyDepartures(): Promise<HourlyData[]>
  getClassStats(): Promise<ClassStat[]>
}
