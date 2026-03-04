import type {
  Student,
  Event,
  SmsEvent,
  AdminOverride,
  AbsenceRequest,
  RecurringAbsence,
  StudentStatus,
  DashboardStats,
  DailyPresenceData,
  ReasonData,
  HourlyData,
} from '@/types'

export interface GetStudentsOptions {
  filter?: 'ALL' | 'OFF_CAMPUS' | 'PENDING' | 'OVERDUE'
  search?: string
  limit?: number
  offset?: number
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
}

export interface CreateAbsenceRequestPayload {
  studentId: string
  date: string
  reason: string
  startTime: string
  endTime: string
}

export interface IApiClient {
  // Students
  getStudents(options?: GetStudentsOptions): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  getStudentByIdNumber(idNumber: string): Promise<Student | null>
  updateStudentStatus(id: string, status: StudentStatus): Promise<void>

  // Events
  getEvents(studentId: string): Promise<Event[]>
  createEvent(payload: CreateEventPayload): Promise<Event>
  getRecentEvents(limit?: number): Promise<Event[]>

  // SMS
  getSmsEvents(): Promise<SmsEvent[]>
  createSmsEvent(raw: string, studentPhone?: string): Promise<SmsEvent>

  // Admin overrides
  getAdminOverrides(): Promise<AdminOverride[]>
  createAdminOverride(
    studentId: string,
    newStatus: StudentStatus,
    note?: string
  ): Promise<AdminOverride>

  // Absence requests
  getAbsenceRequests(options?: { studentId?: string; status?: AbsenceRequest['status'] }): Promise<AbsenceRequest[]>
  createAbsenceRequest(payload: CreateAbsenceRequestPayload): Promise<AbsenceRequest>
  updateAbsenceRequestStatus(
    id: string,
    status: AbsenceRequest['status'],
    adminNote?: string
  ): Promise<void>

  // Recurring absences
  getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]>

  // Analytics
  getDashboardStats(): Promise<DashboardStats>
  getDailyPresence(days?: number): Promise<DailyPresenceData[]>
  getReasonBreakdown(): Promise<ReasonData[]>
  getHourlyDepartures(): Promise<HourlyData[]>
}
