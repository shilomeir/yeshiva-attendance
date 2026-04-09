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
  ClassStat,
} from '@/types'

export interface QuotaCheckResult {
  success: boolean
  eventId?: string
  error?: 'quota_exceeded' | 'server_error'
  current?: number
  quota?: number
}

export interface GetStudentsOptions {
  filter?: 'ALL' | 'OFF_CAMPUS' | 'PENDING'
  search?: string
  grade?: string
  classId?: string
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
  date: string        // YYYY-MM-DD start date
  endDate?: string    // YYYY-MM-DD end date (optional, multi-day)
  reason: string
  startTime: string
  endTime: string
  isUrgent?: boolean
}

export interface IApiClient {
  // Students
  getStudents(options?: GetStudentsOptions): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  getStudentByIdNumber(idNumber: string): Promise<Student | null>
  updateStudentStatus(id: string, status: StudentStatus): Promise<void>
  updateStudentGrade(id: string, grade: string, classId: string): Promise<void>
  updateStudentLocation(id: string, lat: number, lng: number): Promise<void>
  updateStudentFcmToken(id: string, token: string): Promise<void>
  updatePushToken(id: string, token: string | null): Promise<void>
  sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }>

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
  getUrgentRequests(): Promise<AbsenceRequest[]>

  // Recurring absences
  getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]>

  // Student management
  addStudent(data: { fullName: string; idNumber: string; phone: string; grade: string; classId: string }): Promise<Student>
  deleteStudent(id: string): Promise<void>
  getLongAbsentStudents(days?: number): Promise<Student[]>

  // Analytics
  getDashboardStats(): Promise<DashboardStats>
  getDailyPresence(days?: number): Promise<DailyPresenceData[]>
  getReasonBreakdown(): Promise<ReasonData[]>
  getHourlyDepartures(): Promise<HourlyData[]>
  getClassStats(): Promise<ClassStat[]>
  getClassOutsideCount(classId: string): Promise<number>
  cancelAbsenceRequest(id: string): Promise<void>
  markOverdueStudents(): Promise<number>
  autoReturnStudents(): Promise<number>
  createCheckoutWithQuotaCheck(
    studentId: string,
    classId: string,
    grade: string,
    reason: string | null,
    expectedReturn: string | null
  ): Promise<QuotaCheckResult>
}
