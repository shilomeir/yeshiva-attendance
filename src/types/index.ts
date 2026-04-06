// OVERDUE kept for DB backward-compat only — treated as OFF_CAMPUS everywhere in UI
export type StudentStatus = 'ON_CAMPUS' | 'OFF_CAMPUS' | 'OVERDUE' | 'PENDING'

export type GPSStatus = 'GRANTED' | 'DENIED_BY_USER' | 'UNAVAILABLE' | 'PENDING'

export type EventType =
  | 'CHECK_IN'
  | 'CHECK_OUT'
  | 'OVERRIDE'
  | 'SMS_IN'
  | 'SMS_OUT'

export type AbsenceRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface Student {
  id: string
  fullName: string
  idNumber: string
  phone: string
  deviceToken: string | null
  currentStatus: StudentStatus
  lastSeen: string | null // ISO date string
  lastLocation: { lat: number; lng: number } | null
  pendingApproval: boolean
  createdAt: string // ISO date string
  grade: string    // e.g. "שיעור א'"
  classId: string  // e.g. "שיעור א' כיתה 1" (single-class grades: same as grade name)
}

export interface Event {
  id: string
  studentId: string
  type: EventType
  timestamp: string // ISO date string
  reason: string | null
  expectedReturn: string | null // ISO date string
  gpsLat: number | null
  gpsLng: number | null
  gpsStatus: GPSStatus
  distanceFromCampus: number | null // meters
  note: string | null
  syncedAt: string | null // ISO date string
}

export interface SmsEvent {
  id: string
  studentId: string | null
  rawMessage: string
  parsedCorrectly: boolean
  parsedType: EventType | null
  parsedTime: string | null
  parsedReason: string | null
  timestamp: string // ISO date string
  webhookError: string | null
}

export interface AdminOverride {
  id: string
  studentId: string
  adminId: string
  action: string
  previousStatus: StudentStatus
  newStatus: StudentStatus
  timestamp: string // ISO date string
  note: string | null
}

export interface SyncQueueItem {
  id: string
  tableName: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  payload: Record<string, unknown>
  clientTimestamp: string // ISO date string
  retryCount: number
}

export interface RecurringAbsence {
  id: string
  studentId: string
  dayOfWeek: number // 0=Sunday, 6=Saturday
  startTime: string // HH:MM
  endTime: string // HH:MM
  reason: string
  isActive: boolean
}

export interface AbsenceRequest {
  id: string
  studentId: string
  date: string // YYYY-MM-DD (start date)
  endDate: string | null // YYYY-MM-DD (end date, null = same-day)
  reason: string
  startTime: string // HH:MM
  endTime: string // HH:MM
  status: AbsenceRequestStatus
  adminNote: string | null
  isUrgent: boolean // exceptional/urgent request requiring admin approval
  createdAt: string // ISO date string
}

export interface DashboardStats {
  total: number
  onCampus: number
  offCampus: number  // includes OVERDUE (treated as off-campus)
  pending: number
  longAbsent: number // students not on campus for 7+ days
}

export interface ClassStat {
  grade: string
  classId: string
  total: number
  onCampus: number
  offCampus: number  // includes OVERDUE
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
