import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db/schema'
import { parseSmsMessage } from '@/lib/sms/parser'
import { DEFAULT_GRADE, DEFAULT_CLASS } from '@/lib/constants/grades'
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
import type {
  IApiClient,
  GetStudentsOptions,
  CreateEventPayload,
  CreateAbsenceRequestPayload,
  QuotaCheckResult,
} from './types'

export class MockApiClient implements IApiClient {
  // ---- STUDENTS ----

  async getStudents(options: GetStudentsOptions = {}): Promise<Student[]> {
    const { filter = 'ALL', search = '', grade, classId, limit, offset = 0 } = options

    let students = await db.students.orderBy('fullName').toArray()

    if (filter === 'OFF_CAMPUS') {
      students = students.filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE')
    } else if (filter === 'PENDING') {
      students = students.filter((s) => s.pendingApproval)
    }

    if (grade) {
      students = students.filter((s) => s.grade === grade)
    }
    if (classId) {
      students = students.filter((s) => s.classId === classId)
    }

    if (search) {
      const q = search.toLowerCase()
      students = students.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.idNumber.includes(q) ||
          s.phone.includes(q)
      )
    }

    const paginated = students.slice(offset, limit ? offset + limit : undefined)
    return paginated
  }

  async getStudent(id: string): Promise<Student | null> {
    return (await db.students.get(id)) ?? null
  }

  async getStudentByIdNumber(idNumber: string): Promise<Student | null> {
    return (await db.students.where('idNumber').equals(idNumber).first()) ?? null
  }

  async updateStudentStatus(id: string, status: StudentStatus): Promise<void> {
    await db.students.update(id, {
      currentStatus: status,
      lastSeen: new Date().toISOString(),
    })
  }

  async updateStudentGrade(id: string, grade: string, classId: string): Promise<void> {
    await db.students.update(id, { grade, classId })
  }

  async updateStudentLocation(id: string, lat: number, lng: number): Promise<void> {
    await db.students.update(id, {
      lastLocation: { lat, lng },
      lastSeen: new Date().toISOString(),
    })
  }

  async updatePushToken(id: string, token: string | null): Promise<void> {
    await db.students.update(id, { push_token: token })
  }

  async addStudent(data: { fullName: string; idNumber: string; phone: string; grade: string; classId: string }): Promise<Student> {
    const student: Student = {
      id: uuidv4(),
      fullName: data.fullName,
      idNumber: data.idNumber,
      phone: data.phone,
      deviceToken: null,
      push_token: null,
      currentStatus: 'ON_CAMPUS',
      lastSeen: new Date().toISOString(),
      lastLocation: null,
      pendingApproval: false,
      createdAt: new Date().toISOString(),
      grade: data.grade,
      classId: data.classId,
    }
    await db.students.add(student)
    return student
  }

  async deleteStudent(id: string): Promise<void> {
    await db.students.delete(id)
    await db.events.where('studentId').equals(id).delete()
  }

  async getLongAbsentStudents(days: number = 7): Promise<Student[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffISO = cutoff.toISOString()
    const students = await db.students.toArray()
    return students.filter(
      (s) => s.currentStatus !== 'ON_CAMPUS' && s.lastSeen !== null && s.lastSeen < cutoffISO
    )
  }

  // ---- EVENTS ----

  async getEvents(studentId: string): Promise<Event[]> {
    const events = await db.events
      .where('studentId')
      .equals(studentId)
      .toArray()
    // Sort by timestamp descending (newest first)
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  async createEvent(payload: CreateEventPayload): Promise<Event> {
    const now = new Date().toISOString()
    const event: Event = {
      id: uuidv4(),
      studentId: payload.studentId,
      type: payload.type,
      timestamp: now,
      reason: payload.reason ?? null,
      expectedReturn: payload.expectedReturn ?? null,
      gpsLat: payload.gpsLat ?? null,
      gpsLng: payload.gpsLng ?? null,
      gpsStatus: payload.gpsStatus ?? 'PENDING',
      distanceFromCampus: payload.distanceFromCampus ?? null,
      note: payload.note ?? null,
      syncedAt: null,
    }

    await db.events.add(event)

    // Update student status
    const newStatus: StudentStatus = payload.type === 'CHECK_OUT' ? 'OFF_CAMPUS' : 'ON_CAMPUS'
    await db.students.update(payload.studentId, {
      currentStatus: newStatus,
      lastSeen: now,
      ...(payload.gpsLat && payload.gpsLng
        ? { lastLocation: { lat: payload.gpsLat, lng: payload.gpsLng } }
        : {}),
    })

    // Add to sync queue
    await db.syncQueue.add({
      id: uuidv4(),
      tableName: 'events',
      operation: 'INSERT',
      payload: event as unknown as Record<string, unknown>,
      clientTimestamp: now,
      retryCount: 0,
    })

    return event
  }

  async getRecentEvents(limit: number = 50): Promise<Event[]> {
    const events = await db.events.orderBy('timestamp').reverse().limit(limit).toArray()
    return events
  }

  // ---- SMS ----

  async getSmsEvents(): Promise<SmsEvent[]> {
    return db.smsEvents.orderBy('timestamp').reverse().toArray()
  }

  async createSmsEvent(raw: string, studentPhone?: string): Promise<SmsEvent> {
    const now = new Date().toISOString()
    const parsed = parseSmsMessage(raw)

    let studentId: string | null = null
    if (studentPhone) {
      const student = await db.students.where('phone').equals(studentPhone).first()
      studentId = student?.id ?? null
    }

    const smsEvent: SmsEvent = {
      id: uuidv4(),
      studentId,
      rawMessage: raw,
      parsedCorrectly: parsed !== null,
      parsedType: parsed?.type ?? null,
      parsedTime: parsed?.time ?? null,
      parsedReason: parsed?.reason ?? null,
      timestamp: now,
      webhookError: null,
    }

    await db.smsEvents.add(smsEvent)

    // If parsed correctly and student found, create event
    if (parsed && studentId) {
      const eventType = parsed.type
      await this.createEvent({
        studentId,
        type: eventType,
        reason: parsed.reason ?? null,
        note: `מ-SMS: ${raw}`,
      })
    }

    return smsEvent
  }

  // ---- ADMIN OVERRIDES ----

  async getAdminOverrides(): Promise<AdminOverride[]> {
    return db.adminOverrides.orderBy('timestamp').reverse().toArray()
  }

  async createAdminOverride(
    studentId: string,
    newStatus: StudentStatus,
    note?: string
  ): Promise<AdminOverride> {
    const student = await db.students.get(studentId)
    if (!student) throw new Error('Student not found')

    const now = new Date().toISOString()
    const override: AdminOverride = {
      id: uuidv4(),
      studentId,
      adminId: 'admin',
      action: 'STATUS_OVERRIDE',
      previousStatus: student.currentStatus,
      newStatus,
      timestamp: now,
      note: note ?? null,
    }

    await db.adminOverrides.add(override)
    await db.students.update(studentId, {
      currentStatus: newStatus,
      lastSeen: now,
    })

    return override
  }

  // ---- ABSENCE REQUESTS ----

  async getAbsenceRequests(
    options: { studentId?: string; status?: AbsenceRequest['status'] } = {}
  ): Promise<AbsenceRequest[]> {
    let requests = await db.absenceRequests.orderBy('createdAt').reverse().toArray()

    if (options.studentId) {
      requests = requests.filter((r) => r.studentId === options.studentId)
    }
    if (options.status) {
      requests = requests.filter((r) => r.status === options.status)
    }

    return requests
  }

  async createAbsenceRequest(payload: CreateAbsenceRequestPayload): Promise<AbsenceRequest> {
    const request: AbsenceRequest = {
      id: uuidv4(),
      studentId: payload.studentId,
      date: payload.date,
      endDate: payload.endDate ?? null,
      reason: payload.reason,
      startTime: payload.startTime,
      endTime: payload.endTime,
      status: 'PENDING',
      adminNote: null,
      createdAt: new Date().toISOString(),
      isUrgent: payload.isUrgent ?? false,
    }

    await db.absenceRequests.add(request)
    return request
  }

  async updateAbsenceRequestStatus(
    id: string,
    status: AbsenceRequest['status'],
    adminNote?: string
  ): Promise<void> {
    await db.absenceRequests.update(id, { status, adminNote: adminNote ?? null })

    // Write audit record for approve / reject / cancel
    if (status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED') {
      const request = await db.absenceRequests.get(id)
      if (request) {
        const student = await db.students.get(request.studentId)
        const currentStatus = student?.currentStatus ?? 'ON_CAMPUS'
        const auditNote = adminNote
          ? adminNote
          : status === 'APPROVED' ? 'בקשת היעדרות אושרה'
          : status === 'REJECTED' ? 'בקשת היעדרות נדחתה'
          : 'בקשת היעדרות בוטלה ע"י מנהל'
        const action = status === 'APPROVED' ? 'approve_absence_request'
          : status === 'REJECTED' ? 'reject_absence_request'
          : 'cancel_absence_request'
        await db.adminOverrides.add({
          id: uuidv4(),
          studentId: request.studentId,
          adminId: 'admin',
          action,
          previousStatus: currentStatus,
          newStatus: currentStatus,
          timestamp: new Date().toISOString(),
          note: auditNote,
        })
      }
    }
  }

  async getUrgentRequests(): Promise<AbsenceRequest[]> {
    const requests = await db.absenceRequests.toArray()
    return requests.filter((r) => r.isUrgent && r.status === 'PENDING')
  }

  // ---- RECURRING ABSENCES ----

  async getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]> {
    return db.recurringAbsences
      .where('studentId')
      .equals(studentId)
      .filter((r) => r.isActive)
      .toArray()
  }

  // ---- ANALYTICS ----

  async getDashboardStats(): Promise<DashboardStats> {
    const students = await db.students.toArray()
    const total = students.length
    const onCampus = students.filter((s) => s.currentStatus === 'ON_CAMPUS').length
    const offCampus = students.filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length
    const pending = students.filter((s) => s.pendingApproval).length
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffISO = cutoff.toISOString()
    const longAbsent = students.filter(
      (s) => s.currentStatus !== 'ON_CAMPUS' && s.lastSeen !== null && s.lastSeen < cutoffISO
    ).length

    return { total, onCampus, offCampus, pending, longAbsent }
  }

  async getDailyPresence(days: number = 7): Promise<DailyPresenceData[]> {
    const result: DailyPresenceData[] = []
    const now = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]

      const dayStart = new Date(dateStr + 'T00:00:00.000Z')
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z')

      const checkOuts = await db.events
        .where('timestamp')
        .between(dayStart.toISOString(), dayEnd.toISOString())
        .filter((e) => e.type === 'CHECK_OUT')
        .count()

      const total = await db.students.count()

      result.push({
        date: dateStr,
        onCampus: Math.max(0, total - checkOuts),
        offCampus: checkOuts,
      })
    }

    return result
  }

  async getReasonBreakdown(): Promise<ReasonData[]> {
    const events = await db.events
      .where('type')
      .equals('CHECK_OUT')
      .toArray()

    const reasonMap: Record<string, number> = {}
    for (const event of events) {
      const reason = event.reason ?? 'אחר'
      reasonMap[reason] = (reasonMap[reason] ?? 0) + 1
    }

    return Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
  }

  async getHourlyDepartures(): Promise<HourlyData[]> {
    const events = await db.events
      .where('type')
      .equals('CHECK_OUT')
      .toArray()

    const hourMap: Record<number, number> = {}
    for (let h = 0; h < 24; h++) hourMap[h] = 0

    for (const event of events) {
      const hour = new Date(event.timestamp).getHours()
      hourMap[hour] = (hourMap[hour] ?? 0) + 1
    }

    return Object.entries(hourMap).map(([hour, count]) => ({
      hour: Number(hour),
      count,
    }))
  }

  async getClassStats(): Promise<ClassStat[]> {
    const students = await db.students.toArray()

    // Group by classId
    const classMap = new Map<string, { grade: string; classId: string; students: Student[] }>()
    for (const s of students) {
      const key = s.classId
      if (!classMap.has(key)) {
        classMap.set(key, { grade: s.grade ?? DEFAULT_GRADE, classId: s.classId ?? DEFAULT_CLASS, students: [] })
      }
      classMap.get(key)!.students.push(s)
    }

    const stats: ClassStat[] = []
    for (const [, { grade, classId, students: classStudents }] of classMap) {
      const total = classStudents.length
      const onCampus = classStudents.filter((s) => s.currentStatus === 'ON_CAMPUS').length
      const offCampus = classStudents.filter((s) => s.currentStatus === 'OFF_CAMPUS').length
      stats.push({ grade, classId, total, onCampus, offCampus })
    }

    // Sort by grade name then classId
    return stats.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, 'he')
      return a.classId.localeCompare(b.classId, 'he')
    })
  }

  // FCM token — no-op in mock/dev mode (only used in native APK)
  async updateStudentFcmToken(_id: string, _token: string): Promise<void> {
    // noop in browser/dev mode
  }

  async getClassOutsideCount(classId: string): Promise<number> {
    const outside = await db.students
      .where('classId').equals(classId)
      .filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE')
      .toArray()
    if (outside.length === 0) return 0

    const today = new Date().toISOString().split('T')[0]
    const outsideIds = new Set(outside.map((s) => s.id))
    const urgentApproved = await db.absenceRequests
      .filter((r) => outsideIds.has(r.studentId) && r.isUrgent && r.status === 'APPROVED' && r.date === today)
      .toArray()
    const urgentExemptIds = new Set(urgentApproved.map((r) => r.studentId))
    return outside.filter((s) => !urgentExemptIds.has(s.id)).length
  }

  async cancelAbsenceRequest(id: string): Promise<void> {
    await db.absenceRequests.update(id, { status: 'CANCELLED' as const })
  }

  async autoReturnStudents(): Promise<number> {
    const now = new Date().toISOString()
    const offCampus = await db.students
      .filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE')
      .toArray()
    let count = 0
    for (const student of offCampus) {
      const events = await db.events.where('studentId').equals(student.id).toArray()
      const lastCheckout = events
        .filter((e) => e.type === 'CHECK_OUT' && e.expectedReturn)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]
      if (lastCheckout?.expectedReturn && lastCheckout.expectedReturn < now) {
        await db.students.update(student.id, { currentStatus: 'ON_CAMPUS', lastSeen: now })
        count++
      }
    }
    return count
  }

  async markOverdueStudents(): Promise<number> {
    const now = new Date()
    const offCampus = await db.students
      .filter((s) => s.currentStatus === 'OFF_CAMPUS')
      .toArray()
    if (offCampus.length === 0) return 0

    let count = 0
    for (const student of offCampus) {
      const events = await db.events
        .where('studentId').equals(student.id)
        .and((e) => e.type === 'CHECK_OUT' && e.expectedReturn != null)
        .toArray()
      if (events.length === 0) continue
      // Find most recent CHECK_OUT
      const latest = events.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0]
      if (latest.expectedReturn && new Date(latest.expectedReturn) < now) {
        await db.students.update(student.id, { currentStatus: 'OVERDUE' })
        count++
      }
    }
    return count
  }

  async createCheckoutWithQuotaCheck(
    studentId: string,
    classId: string,
    grade: string,
    reason: string | null,
    expectedReturn: string | null
  ): Promise<QuotaCheckResult> {
    // Check quota client-side in mock
    const count = await this.getClassOutsideCount(classId)
    const quota = (grade === 'אברכים' || grade === 'בוגרצים') ? 6 : 3
    if (count >= quota) {
      return { success: false, error: 'quota_exceeded', current: count, quota }
    }
    // Create checkout event
    const event = await this.createEvent({
      studentId,
      type: 'CHECK_OUT',
      reason,
      expectedReturn,
      gpsLat: null,
      gpsLng: null,
      gpsStatus: 'PENDING',
      distanceFromCampus: null,
    })
    return { success: true, eventId: event.id }
  }
}
