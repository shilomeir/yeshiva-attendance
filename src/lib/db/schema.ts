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
import { DEFAULT_GRADE, DEFAULT_CLASS } from '@/lib/constants/grades'

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

    // v1 — original schema (kept for migration path)
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

    // v2 — adds grade / classId indexes on students
    this.version(2).stores({
      students:
        '&id, fullName, idNumber, phone, deviceToken, currentStatus, lastSeen, pendingApproval, createdAt, grade, classId',
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
    }).upgrade((tx) => {
      // Assign default grade/class to any students that pre-date this migration
      return tx.table('students').toCollection().modify((s) => {
        if (!s.grade) s.grade = DEFAULT_GRADE
        if (!s.classId) s.classId = DEFAULT_CLASS
      })
    })
  }
}

export const db = new YeshivaDB()
