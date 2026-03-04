import Dexie, { Table } from 'dexie'
import type {
  Student,
  Event,
  SmsEvent,
  AdminOverride,
  SyncQueueItem,
  RecurringAbsence,
  AbsenceRequest,
} from '@/types'

export class YeshivaDB extends Dexie {
  students!: Table<Student, string>
  events!: Table<Event, string>
  smsEvents!: Table<SmsEvent, string>
  adminOverrides!: Table<AdminOverride, string>
  syncQueue!: Table<SyncQueueItem, string>
  recurringAbsences!: Table<RecurringAbsence, string>
  absenceRequests!: Table<AbsenceRequest, string>

  constructor() {
    super('YeshivaAttendanceDB')

    this.version(1).stores({
      students:
        '&id, fullName, idNumber, phone, deviceToken, currentStatus, lastSeen, pendingApproval, createdAt',
      events:
        '&id, studentId, type, timestamp, reason, expectedReturn, gpsStatus, syncedAt',
      smsEvents:
        '&id, studentId, parsedType, timestamp, parsedCorrectly',
      adminOverrides:
        '&id, studentId, adminId, action, timestamp',
      syncQueue:
        '&id, tableName, operation, clientTimestamp, retryCount',
      recurringAbsences:
        '&id, studentId, dayOfWeek, isActive',
      absenceRequests:
        '&id, studentId, date, status, createdAt',
    })
  }
}

export const db = new YeshivaDB()
