import Dexie, { Table } from 'dexie'
import type {
  Student,
  Event,
  AdminOverride,
  SyncQueueItem,
  RecurringAbsence,
  AbsenceRequest,
  Departure,
} from '@/types'
import { DEFAULT_GRADE, DEFAULT_CLASS } from '@/lib/constants/grades'

export class YeshivaDB extends Dexie {
  students!: Table<Student, string>
  events!: Table<Event, string>
  adminOverrides!: Table<AdminOverride, string>
  syncQueue!: Table<SyncQueueItem, string>
  recurringAbsences!: Table<RecurringAbsence, string>
  absenceRequests!: Table<AbsenceRequest, string>
  departures!: Table<Departure, string>

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

    // v3 — unified departures table + departure_id index on events
    this.version(3).stores({
      students:
        '&id, fullName, idNumber, phone, deviceToken, currentStatus, lastSeen, pendingApproval, createdAt, grade, classId',
      events:
        '&id, studentId, type, timestamp, reason, expectedReturn, gpsStatus, syncedAt, departure_id',
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
      departures:
        '&id, student_id, class_id, status, start_at, end_at',
    })

    // v4 — removes smsEvents object store (SMS system removed)
    this.version(4).stores({
      students:
        '&id, fullName, idNumber, phone, deviceToken, currentStatus, lastSeen, pendingApproval, createdAt, grade, classId',
      events:
        '&id, studentId, type, timestamp, reason, expectedReturn, gpsStatus, syncedAt, departure_id',
      smsEvents: null,
      adminOverrides:
        '&id, studentId, adminId, action, timestamp',
      syncQueue:
        '&id, tableName, operation, clientTimestamp, retryCount',
      recurringAbsences:
        '&id, studentId, dayOfWeek, isActive',
      absenceRequests:
        '&id, studentId, date, status, createdAt',
      departures:
        '&id, student_id, class_id, status, start_at, end_at',
    })

    // v5 — adds lastAttemptAt index to syncQueue for backoff; removes absenceRequests
    //       (table no longer exists in DB schema — replaced by departures)
    this.version(5).stores({
      students:
        '&id, fullName, idNumber, phone, deviceToken, currentStatus, lastSeen, pendingApproval, createdAt, grade, classId',
      events:
        '&id, studentId, type, timestamp, reason, expectedReturn, gpsStatus, syncedAt, departure_id',
      adminOverrides:
        '&id, studentId, adminId, action, timestamp',
      syncQueue:
        '&id, tableName, operation, clientTimestamp, retryCount, lastAttemptAt',
      recurringAbsences:
        '&id, studentId, dayOfWeek, isActive',
      absenceRequests: null,
      departures:
        '&id, student_id, class_id, status, start_at, end_at',
    })
  }
}

export const db = new YeshivaDB()
