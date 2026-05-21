import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db/schema'
import { DEFAULT_GRADE, DEFAULT_CLASS } from '@/lib/constants/grades'
import { calcQuota } from '@/lib/quota'
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
  CalendarDeparture,
  Departure,
  DepartureStatus,
  SubmitDepartureResult,
  DepartureSubmitResult,
  QuotaFullResult,
  AuditSessionWithDetails,
  AuditSessionSummary,
  AuditEntry,
  AuditClassState,
  AuditSessionMode,
  AuditEntryStatus,
} from '@/types'
import type {
  IApiClient,
  GetStudentsOptions,
  SubmitDeparturePayload,
  ListDeparturesOptions,
  CreateEventPayload,
  PushNotificationTarget,
  AddStudentPayload,
  UpdateStudentPayload,
  AppResult,
} from './types'

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d
}

const AUDIT_LOG_RETENTION_MS = 48 * 60 * 60 * 1000

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart)
}

export class MockApiClient implements IApiClient {

  // ── Students ───────────────────────────────────────────────────────────────

  async getStudents(options: GetStudentsOptions = {}): Promise<Student[]> {
    const { filter = 'ALL', search = '', grade, classId, limit, offset = 0 } = options

    let students = await db.students.orderBy('fullName').toArray()

    if (filter === 'OFF_CAMPUS') {
      students = students.filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE')
    } else if (filter === 'PENDING') {
      students = students.filter((s) => s.pendingApproval)
    }

    if (grade) students = students.filter((s) => s.grade === grade)
    if (classId) students = students.filter((s) => s.classId === classId)

    if (search) {
      const q = search.toLowerCase()
      students = students.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.idNumber.includes(q) ||
          s.phone.includes(q)
      )
    }

    return students.slice(offset, limit ? offset + limit : undefined)
  }

  async getStudent(id: string): Promise<Student | null> {
    return (await db.students.get(id)) ?? null
  }

  async getStudentsByIds(ids: string[]): Promise<Record<string, Student>> {
    if (ids.length === 0) return {}
    const students = await db.students.where('id').anyOf(ids).toArray()
    return Object.fromEntries(students.map((s) => [s.id, s]))
  }

  async getStudentByIdNumber(idNumber: string): Promise<Student | null> {
    return (await db.students.where('idNumber').equals(idNumber).first()) ?? null
  }

  async updateStudentStatus(id: string, status: StudentStatus): Promise<void> {
    await db.students.update(id, { currentStatus: status, lastSeen: new Date().toISOString() })
  }

  async updateStudentGrade(id: string, grade: string, classId: string): Promise<void> {
    await db.students.update(id, { grade, classId })
  }

  async updateStudentLocation(id: string, lat: number, lng: number): Promise<void> {
    await db.students.update(id, { lastLocation: { lat, lng }, lastSeen: new Date().toISOString() })
  }

  async updateStudentFcmToken(_id: string, _token: string): Promise<void> {
    // no-op in browser/dev mode
  }

  async updatePushToken(id: string, token: string | null): Promise<void> {
    await db.students.update(id, { push_token: token })
  }

  async sendPushNotification(
    _title: string,
    _body: string,
    target: PushNotificationTarget = {},
  ): Promise<{ sent: number; failed: number; lastError?: string }> {
    if (target.studentIds && target.studentIds.length === 0) {
      return { sent: 0, failed: 0 }
    }

    let students = await db.students.toArray()
    if (target.studentIds) {
      const ids = new Set(target.studentIds)
      students = students.filter((s) => ids.has(s.id))
    } else if (target.classId) {
      students = students.filter((s) => s.classId === target.classId)
    } else if (target.grade) {
      students = students.filter((s) => s.grade === target.grade)
    }

    return { sent: students.filter((s) => Boolean(s.push_token)).length, failed: 0 }
  }

  async sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }> {
    return this.sendPushNotification(title, body)
  }

  async sendAuditPush(params: { sessionId: string; adminPin: string; title?: string; message?: string }): Promise<{ sent: number; failed: number; removed: number; total: number; lastError?: string } | { error: string }> {
    // Mock: no actual push delivery, just return the snapshot count as 'sent'
    // so calling code can render the success toast in dev/test.
    const session = this._mockAuditSession
    if (!session || session.id !== params.sessionId) return { error: 'SESSION_NOT_FOUND' }
    if (session.status !== 'ACTIVE') return { error: 'SESSION_CLOSED' }
    if (!params.adminPin) return { error: 'AUTH' }
    return { sent: session.studentSnapshot.length, failed: 0, removed: 0, total: session.studentSnapshot.length }
  }

  async addStudent(student: AddStudentPayload): Promise<AppResult<Student>> {
    if (!/^\d{9}$/.test(student.idNumber)) {
      return { error: { message: 'מספר זהות חייב להיות 9 ספרות' } }
    }
    const existing = await db.students.where('idNumber').equals(student.idNumber).first()
    if (existing) {
      return { error: { message: 'תלמיד עם מספר זהות זה כבר קיים במערכת' } }
    }
    const now = new Date().toISOString()
    const newStudent: Student = {
      id:            uuidv4(),
      idNumber:      student.idNumber,
      fullName:      student.fullName,
      phone:         student.phone,
      grade:         student.grade,
      classId:       student.classId,
      currentStatus: 'ON_CAMPUS',
      lastSeen:      now,
      lastLocation:  null,
      deviceToken:   null,
      push_token:    null,
      pendingApproval: false,
      createdAt:     now,
    }
    await db.students.add(newStudent)
    return { data: newStudent }
  }

  async updateStudent(id: string, updates: UpdateStudentPayload): Promise<AppResult<Student>> {
    const student = await db.students.get(id)
    if (!student) return { error: { message: 'תלמיד לא נמצא' } }
    const updated = { ...student, ...updates }
    await db.students.put(updated)
    return { data: updated }
  }

  async deleteStudent(id: string): Promise<void> {
    // Guard: refuse to delete a student with an ACTIVE or PENDING departure
    const activeDeps = await db.departures
      .where('student_id').equals(id)
      .filter(d => ['ACTIVE', 'PENDING', 'APPROVED'].includes(d.status))
      .first()
    if (activeDeps) {
      throw new Error('לא ניתן למחוק תלמיד עם יציאה פעילה. בטל את היציאה תחילה.')
    }
    await db.students.delete(id)
    await db.events.where('studentId').equals(id).delete()
    await db.departures.where('student_id').equals(id).delete()
  }

  async getClassSize(classId: string): Promise<number> {
    return db.students.where('classId').equals(classId).count()
  }

  async getLongAbsentStudents(days = 7): Promise<Student[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffISO = cutoff.toISOString()
    const students = await db.students.toArray()
    return students.filter(
      (s) => s.currentStatus !== 'ON_CAMPUS' && s.lastSeen !== null && s.lastSeen < cutoffISO
    )
  }

  // ── Departures ─────────────────────────────────────────────────────────────

  async submitDeparture(payload: SubmitDeparturePayload): Promise<SubmitDepartureResult> {
    const now = new Date()
    const startAt = toIso(payload.startAt)
    const endAt = toIso(payload.endAt)

    const student = await db.students.get(payload.studentId)
    if (!student) return { error: 'Student not found' }

    const classId = student.classId
    const classSize = await this.getClassSize(classId)
    const quota = calcQuota(classSize)

    const allDepartures = await db.departures.where('class_id').equals(classId).toArray()

    const overlapRows = allDepartures.filter(
      (d) =>
        !d.is_urgent &&
        (d.status === 'APPROVED' || d.status === 'ACTIVE') &&
        d.student_id !== payload.studentId &&
        overlaps(d.start_at, d.end_at, startAt, endAt)
    )
    const current = overlapRows.length

    // Determine initial status
    let status: DepartureStatus
    const isAdminOverride = payload.source === 'ADMIN_OVERRIDE'

    if (isAdminOverride) {
      status = 'APPROVED'
    } else if (payload.isUrgent) {
      status = 'PENDING'
    } else if (current < quota) {
      status = 'APPROVED'
    } else if (!payload.forcePending) {
      // Return QUOTA_FULL without inserting
      const overlappingStudentIds = overlapRows.map((d) => d.student_id)
      const overlappingStudents = await db.students.where('id').anyOf(overlappingStudentIds).toArray()
      const studentMap = Object.fromEntries(overlappingStudents.map((s) => [s.id, s]))

      return {
        status: 'QUOTA_FULL',
        current,
        quota,
        overlapping: overlapRows.map((d) => ({
          studentId: d.student_id,
          studentName: studentMap[d.student_id]?.fullName ?? '',
          endAt: d.end_at,
        })),
      } satisfies QuotaFullResult
    } else {
      status = 'PENDING'
    }

    // Auto-activate if approved and start_at is now or past
    if (status === 'APPROVED' && new Date(startAt) <= now) {
      status = 'ACTIVE'
    }

    const id = uuidv4()
    const departure: Departure = {
      id,
      student_id: payload.studentId,
      class_id: classId,
      start_at: startAt,
      end_at: endAt,
      status,
      source: payload.source ?? 'SELF',
      is_urgent: payload.isUrgent ?? false,
      reason: payload.reason ?? null,
      admin_note: null,
      approved_by: payload.approvedBy ?? null,
      created_at: now.toISOString(),
      approved_at: (status === 'APPROVED' || status === 'ACTIVE') ? now.toISOString() : null,
      activated_at: status === 'ACTIVE' ? now.toISOString() : null,
      completed_at: null,
      cancelled_at: null,
      rejected_at: null,
      gps_lat: null,
      gps_lng: null,
    }

    await db.departures.add(departure)

    if (status === 'ACTIVE') {
      await db.students.update(payload.studentId, { currentStatus: 'OFF_CAMPUS', lastSeen: now.toISOString() })
    }

    await db.adminOverrides.add({
      id: uuidv4(),
      studentId: payload.studentId,
      adminId: payload.actorId ?? 'system',
      action: 'submit_departure',
      previousStatus: student.currentStatus,
      newStatus: status,
      timestamp: now.toISOString(),
      note: payload.reason ?? null,
    })

    return {
      id,
      status,
      quota,
      current,
      notifyAdmin: status === 'PENDING' && current >= quota,
    } satisfies DepartureSubmitResult
  }

  async approveDeparture(
    id: string,
    actorId: string,
    _actorRole?: 'ADMIN' | 'SUPERVISOR',
    note?: string,
  ): Promise<{ status: DepartureStatus } | { error: string }> {
    const dep = await db.departures.get(id)
    if (!dep) return { error: 'Departure not found' }
    if (dep.status !== 'PENDING') return { error: `Cannot approve departure in status ${dep.status}` }

    const now = new Date()
    const newStatus: DepartureStatus = new Date(dep.start_at) <= now ? 'ACTIVE' : 'APPROVED'

    await db.departures.update(id, {
      status: newStatus,
      approved_by: actorId,
      approved_at: now.toISOString(),
      ...(newStatus === 'ACTIVE' ? { activated_at: now.toISOString() } : {}),
      admin_note: note ?? null,
    })

    if (newStatus === 'ACTIVE') {
      await db.students.update(dep.student_id, { currentStatus: 'OFF_CAMPUS', lastSeen: now.toISOString() })
    }

    await db.adminOverrides.add({
      id: uuidv4(),
      studentId: dep.student_id,
      adminId: actorId,
      action: 'approve_departure',
      previousStatus: 'PENDING',
      newStatus,
      timestamp: now.toISOString(),
      note: note ?? null,
    })

    // Simulate push notification (mirrors supabaseClient which calls approve_departure RPC + send-push)
    console.debug('[mock] Push: departure approved for student', dep.student_id)

    return { status: newStatus }
  }

  async rejectDeparture(
    id: string,
    actorId: string,
    _actorRole?: 'ADMIN' | 'SUPERVISOR',
    note?: string,
  ): Promise<{ status: 'REJECTED' } | { error: string }> {
    const dep = await db.departures.get(id)
    if (!dep) return { error: 'Departure not found' }
    if (dep.status !== 'PENDING') return { error: `Cannot reject departure in status ${dep.status}` }

    const now = new Date().toISOString()
    await db.departures.update(id, { status: 'REJECTED', rejected_at: now, admin_note: note ?? null })

    await db.adminOverrides.add({
      id: uuidv4(),
      studentId: dep.student_id,
      adminId: actorId,
      action: 'reject_departure',
      previousStatus: 'PENDING',
      newStatus: 'REJECTED',
      timestamp: now,
      note: note ?? null,
    })

    return { status: 'REJECTED' }
  }

  async cancelDeparture(
    id: string,
    actorId: string,
    _actorRole?: 'STUDENT' | 'ADMIN' | 'SUPERVISOR',
    note?: string,
  ): Promise<{ status: 'CANCELLED' } | { error: string }> {
    const dep = await db.departures.get(id)
    if (!dep) return { error: 'Departure not found' }
    const terminal: DepartureStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED']
    if (terminal.includes(dep.status)) return { error: `Cannot cancel departure in status ${dep.status}` }

    const now = new Date().toISOString()
    await db.departures.update(id, { status: 'CANCELLED', cancelled_at: now, admin_note: note ?? null })

    // Return student to ON_CAMPUS only if this was their active departure
    if (dep.status === 'ACTIVE') {
      const otherActive = await db.departures
        .where('student_id')
        .equals(dep.student_id)
        .filter((d) => d.status === 'ACTIVE' && d.id !== id)
        .count()
      if (otherActive === 0) {
        await db.students.update(dep.student_id, { currentStatus: 'ON_CAMPUS', lastSeen: now })
      }
    }

    await db.adminOverrides.add({
      id: uuidv4(),
      studentId: dep.student_id,
      adminId: actorId,
      action: 'cancel_departure',
      previousStatus: dep.status,
      newStatus: 'CANCELLED',
      timestamp: now,
      note: note ?? null,
    })

    return { status: 'CANCELLED' }
  }

  async returnDeparture(
    id: string,
    studentId?: string,
    gpsLat?: number,
    gpsLng?: number,
  ): Promise<{ status: 'COMPLETED' } | { error: string }> {
    const dep = await db.departures.get(id)
    if (!dep) return { error: 'Departure not found' }
    if (dep.status !== 'ACTIVE') return { error: `Cannot return departure in status ${dep.status}` }

    const now = new Date().toISOString()
    await db.departures.update(id, { status: 'COMPLETED', completed_at: now })

    // Create CHECK_IN audit event
    await db.events.add({
      id: uuidv4(),
      studentId: dep.student_id,
      type: 'CHECK_IN',
      timestamp: now,
      reason: null,
      expectedReturn: null,
      gpsLat: gpsLat ?? null,
      gpsLng: gpsLng ?? null,
      gpsStatus: gpsLat ? 'GRANTED' : 'PENDING',
      distanceFromCampus: null,
      note: null,
      syncedAt: null,
      departure_id: id,
    })

    const resolvedStudentId = studentId ?? dep.student_id
    const otherActive = await db.departures
      .where('student_id')
      .equals(resolvedStudentId)
      .filter((d) => d.status === 'ACTIVE' && d.id !== id)
      .count()
    if (otherActive === 0) {
      await db.students.update(resolvedStudentId, { currentStatus: 'ON_CAMPUS', lastSeen: now })
    }

    return { status: 'COMPLETED' }
  }

  async listDepartures(options: ListDeparturesOptions = {}): Promise<CalendarDeparture[]> {
    let departures = await db.departures.toArray()

    // Mirror v_calendar_departures view: exclude terminal non-visible states unless caller asks
    if (!options.status) {
      const visible: DepartureStatus[] = ['PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED']
      departures = departures.filter((d) => visible.includes(d.status))
    }

    if (options.studentId) departures = departures.filter((d) => d.student_id === options.studentId)
    if (options.classId) {
      const classStudents = await db.students.where('classId').equals(options.classId).toArray()
      const ids = new Set(classStudents.map((s) => s.id))
      departures = departures.filter((d) => ids.has(d.student_id))
    }
    if (options.from) {
      const from = toIso(options.from)
      departures = departures.filter((d) => d.start_at >= from)
    }
    if (options.to) {
      const to = toIso(options.to)
      departures = departures.filter((d) => d.start_at <= to)
    }
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status]
      departures = departures.filter((d) => statuses.includes(d.status))
    }
    if (options.limit) departures = departures.slice(0, options.limit)

    const studentIds = [...new Set(departures.map((d) => d.student_id))]
    const studentMap = await this.getStudentsByIds(studentIds)

    const now = new Date()
    return departures.map((d) => {
      const student = studentMap[d.student_id]
      return {
        ...d,
        student_name: student?.fullName ?? '',
        grade: student?.grade ?? '',
        is_overdue_alert: d.status === 'ACTIVE' && new Date(d.end_at) < new Date(now.getTime() - 24 * 60 * 60 * 1000),
      }
    })
  }

  async tickDepartures(): Promise<number> {
    const now = new Date()
    const nowIso = now.toISOString()
    let count = 0

    // Activate APPROVED departures whose start_at has passed
    const toActivate = await db.departures
      .where('status')
      .equals('APPROVED')
      .filter((d) => d.start_at <= nowIso)
      .toArray()

    for (const d of toActivate) {
      await db.departures.update(d.id, { status: 'ACTIVE', activated_at: nowIso })
      await db.students.update(d.student_id, { currentStatus: 'OFF_CAMPUS', lastSeen: nowIso })
      count++
    }

    // Complete ACTIVE departures whose end_at has passed
    const toComplete = await db.departures
      .where('status')
      .equals('ACTIVE')
      .filter((d) => d.end_at <= nowIso)
      .toArray()

    for (const d of toComplete) {
      await db.departures.update(d.id, { status: 'COMPLETED', completed_at: nowIso })
      const otherActive = await db.departures
        .where('student_id')
        .equals(d.student_id)
        .filter((dep) => dep.status === 'ACTIVE' && dep.id !== d.id)
        .count()
      if (otherActive === 0) {
        await db.students.update(d.student_id, { currentStatus: 'ON_CAMPUS', lastSeen: nowIso })
      }
      count++
    }

    // Purge departures older than 30 days
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const terminal: DepartureStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED']
    const toPurge = await db.departures
      .filter((d) => terminal.includes(d.status) && d.end_at < cutoff)
      .toArray()
    for (const d of toPurge) await db.departures.delete(d.id)

    return count
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async getEvents(studentId: string): Promise<Event[]> {
    const events = await db.events.where('studentId').equals(studentId).toArray()
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
      departure_id: payload.departureId ?? null,
    }

    await db.events.add(event)

    // Mirror supabaseClient: update student status on CHECK_IN / CHECK_OUT events
    if (payload.type === 'CHECK_IN' || payload.type === 'CHECK_OUT') {
      const newStatus: StudentStatus = payload.type === 'CHECK_IN' ? 'ON_CAMPUS' : 'OFF_CAMPUS'
      await db.students.update(payload.studentId, { currentStatus: newStatus, lastSeen: now })
    }

    return event
  }

  async deleteEvent(id: string): Promise<void> {
    await db.events.delete(id)
  }

  async getRecentEvents(limit = 50): Promise<Event[]> {
    return db.events.orderBy('timestamp').reverse().limit(limit).toArray()
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  async getAdminOverrides(): Promise<AdminOverride[]> {
    const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_MS).toISOString()
    await db.adminOverrides.where('timestamp').below(cutoff).delete()
    return db.adminOverrides.orderBy('timestamp').reverse().toArray()
  }

  async createAdminOverride(
    studentId: string,
    newStatus: StudentStatus,
    note?: string,
  ): Promise<AdminOverride> {
    const student = await db.students.get(studentId)
    if (!student) throw new Error('Student not found')

    const now = new Date().toISOString()

    if (newStatus === 'OFF_CAMPUS') {
      // Cancel existing live departures first to avoid overlap conflicts
      const live = await db.departures
        .where('student_id')
        .equals(studentId)
        .filter((d) => d.status === 'PENDING' || d.status === 'APPROVED' || d.status === 'ACTIVE')
        .toArray()
      for (const d of live) {
        await db.departures.update(d.id, { status: 'CANCELLED', cancelled_at: now })
      }

      // Create an admin-override departure (valid until end of day by default)
      const endDate = new Date()
      endDate.setHours(23, 59, 0, 0)
      if (endDate <= new Date()) endDate.setDate(endDate.getDate() + 1)
      const result = await this.submitDeparture({
        studentId,
        startAt: now,
        endAt: endDate.toISOString(),
        reason: note ?? null,
        source: 'ADMIN_OVERRIDE',
        approvedBy: 'admin',
        actorId: 'admin',
        actorRole: 'ADMIN',
      })
      if ('error' in result) throw new Error((result as { error: string }).error)
    } else if (newStatus === 'ON_CAMPUS') {
      // Use cancelDeparture so logging + status update mirrors the RPC path
      const live = await db.departures
        .where('student_id')
        .equals(studentId)
        .filter((d) => d.status === 'ACTIVE' || d.status === 'APPROVED' || d.status === 'PENDING')
        .toArray()
      for (const d of live) {
        await this.cancelDeparture(d.id, 'admin', 'ADMIN', note)
      }
      await db.students.update(studentId, { currentStatus: 'ON_CAMPUS', lastSeen: now })
    } else {
      await db.students.update(studentId, { currentStatus: newStatus, lastSeen: now })
    }

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
    return override
  }

  // ── Recurring absences ────────────────────────────────────────────────────

  async getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]> {
    return db.recurringAbsences
      .where('studentId')
      .equals(studentId)
      .filter((r) => r.isActive)
      .toArray()
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getCampusStatusCounts(): Promise<CampusStatusCounts> {
    const students = await db.students.toArray()
    const byClass: CampusStatusCounts['byClass'] = {}
    for (const s of students) {
      if (!byClass[s.classId]) byClass[s.classId] = { total: 0, onCampus: 0, offCampus: 0 }
      byClass[s.classId].total++
      if (s.currentStatus === 'ON_CAMPUS') byClass[s.classId].onCampus++
      if (s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE') byClass[s.classId].offCampus++
    }
    return {
      total: students.length,
      onCampus: students.filter(s => s.currentStatus === 'ON_CAMPUS').length,
      offCampus: students.filter(s => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length,
      pending: students.filter(s => s.pendingApproval).length,
      byClass,
    }
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const students = await db.students.toArray()
    const onCampus = students.filter((s) => s.currentStatus === 'ON_CAMPUS').length
    const offCampus = students.filter((s) => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length
    const pending = students.filter((s) => s.pendingApproval).length
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffISO = cutoff.toISOString()
    const longAbsent = students.filter(
      (s) => s.currentStatus !== 'ON_CAMPUS' && s.lastSeen !== null && s.lastSeen < cutoffISO
    ).length
    // Exclude PENDING-status students from total (mirrors supabaseClient)
    return { total: onCampus + offCampus, onCampus, offCampus, pending, longAbsent }
  }

  async getDailyPresence(days = 7): Promise<DailyPresenceData[]> {
    const result: DailyPresenceData[] = []
    const now = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      const dayStart = dateStr + 'T00:00:00.000Z'
      const dayEnd = dateStr + 'T23:59:59.999Z'

      const deps = await db.departures
        .filter((d) =>
          ['ACTIVE', 'COMPLETED', 'APPROVED'].includes(d.status) &&
          overlaps(d.start_at, d.end_at, dayStart, dayEnd)
        )
        .count()

      const total = await db.students.count()
      result.push({ date: dateStr, onCampus: Math.max(0, total - deps), offCampus: deps })
    }

    return result
  }

  async getReasonBreakdown(): Promise<ReasonData[]> {
    const departures = await db.departures.toArray()
    const reasonMap: Record<string, number> = {}
    for (const d of departures) {
      const reason = d.reason ?? 'אחר'
      reasonMap[reason] = (reasonMap[reason] ?? 0) + 1
    }
    return Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
  }

  async getHourlyDepartures(): Promise<HourlyData[]> {
    const departures = await db.departures.toArray()
    const hourMap: Record<number, number> = {}
    for (let h = 0; h < 24; h++) hourMap[h] = 0
    for (const d of departures) {
      const hour = new Date(d.start_at).getHours()
      hourMap[hour] = (hourMap[hour] ?? 0) + 1
    }
    return Object.entries(hourMap).map(([hour, count]) => ({ hour: Number(hour), count }))
  }

  async getClassStats(): Promise<ClassStat[]> {
    const students = await db.students.toArray()
    const classMap = new Map<string, { grade: string; classId: string; students: Student[] }>()
    for (const s of students) {
      const key = s.classId
      if (!classMap.has(key)) {
        classMap.set(key, { grade: s.grade ?? DEFAULT_GRADE, classId: s.classId ?? DEFAULT_CLASS, students: [] })
      }
      classMap.get(key)!.students.push(s)
    }
    const stats: ClassStat[] = []
    for (const [, { grade, classId, students: cs }] of classMap) {
      stats.push({
        grade,
        classId,
        total: cs.length,
        onCampus: cs.filter((s) => s.currentStatus === 'ON_CAMPUS').length,
        offCampus: cs.filter((s) => s.currentStatus !== 'ON_CAMPUS').length,
      })
    }
    return stats.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, 'he')
      return a.classId.localeCompare(b.classId, 'he')
    })
  }

  // ── Internal Audit Session (mock — in-memory only) ─────────────────────────

  private _mockAuditSession: AuditSessionWithDetails | null = null

  async startAuditSession(params: { classIds: string[]; title?: string; adminPin: string; mode?: AuditSessionMode }): Promise<AuditSessionWithDetails | { error: string; existingId?: string }> {
    if (this._mockAuditSession?.status === 'ACTIVE') return { error: 'ALREADY_ACTIVE', existingId: this._mockAuditSession.id }
    const students = await db.students.toArray()
    const filtered = students.filter(s => params.classIds.includes(s.classId))
    const snap = filtered.map(s => ({ id: s.id, fullName: s.fullName, idNumber: s.idNumber, classId: s.classId, grade: s.grade }))
    const session: AuditSessionWithDetails = {
      id: uuidv4(), title: params.title ?? null, mode: params.mode ?? 'MANUAL',
      startedAt: new Date().toISOString(), startedBy: 'admin', classIds: params.classIds,
      status: 'ACTIVE', closedAt: null, closedBy: null,
      totalStudentsSnapshot: snap.length, classSnapshot: [], studentSnapshot: snap,
      activeDeparturesSnapshot: [], settings: {}, entries: [], classStates: params.classIds.map(cid => ({
        id: uuidv4(), sessionId: '', classId: cid, status: 'NOT_STARTED',
        startedAt: null, finishedAt: null, finishedBy: null,
        unmarkedAtFinish: null, inYeshivaAtFinish: null, outWithPermAtFinish: null, outWithoutPermAtFinish: null,
        supervisorNote: null, updatedAt: new Date().toISOString(),
      })),
    }
    this._mockAuditSession = session
    return session
  }

  async getActiveAuditSession(): Promise<AuditSessionWithDetails | null> {
    return this._mockAuditSession?.status === 'ACTIVE' ? this._mockAuditSession : null
  }

  async getActiveAuditSessionMinimal() {
    const s = this._mockAuditSession
    if (!s || s.status !== 'ACTIVE') return null
    return { id: s.id, title: s.title, mode: s.mode, startedAt: s.startedAt, classIds: s.classIds, totalStudentsSnapshot: s.totalStudentsSnapshot, status: 'ACTIVE' as const }
  }

  async getActiveAuditForStudent(studentId: string, deviceToken: string) {
    if (!deviceToken) return { error: 'AUTH' }
    const s = this._mockAuditSession
    if (!s || s.status !== 'ACTIVE') return null
    const snap = s.studentSnapshot.find(x => x.id === studentId)
    const isInActiveSession = !!snap && s.classIds.includes(snap.classId)
    const myEntry = s.entries.find(e => e.studentId === studentId) ?? null
    return {
      session: { id: s.id, title: s.title, mode: s.mode, startedAt: s.startedAt, classIds: s.classIds, status: 'ACTIVE' as const },
      isInActiveSession,
      myEntry: myEntry ? {
        id: myEntry.id, status: myEntry.status, source: myEntry.source,
        submittedAt: myEntry.submittedAt,
        distanceFromCampusM: myEntry.distanceFromCampusM ?? null,
        distanceBucket: myEntry.distanceBucket ?? null,
      } : null,
    }
  }

  async getActiveAuditForSupervisor(supervisorPin: string) {
    if (!supervisorPin) return { error: 'AUTH' }
    const s = this._mockAuditSession
    if (!s || s.status !== 'ACTIVE') return null
    // Mock has no PIN-to-class mapping; return full session for backwards parity.
    // The real server scopes by class — tests should rely on the server smoke test.
    return { session: s, isInActiveSession: true }
  }

  async getAuditSession(id: string): Promise<AuditSessionWithDetails | null> {
    return this._mockAuditSession?.id === id ? this._mockAuditSession : null
  }

  async listAuditSessions(): Promise<AuditSessionSummary[]> {
    if (!this._mockAuditSession) return []
    const s = this._mockAuditSession
    const entries = s.entries
    return [{
      id: s.id, title: s.title, startedAt: s.startedAt, closedAt: s.closedAt,
      status: s.status, classIds: s.classIds, totalStudentsSnapshot: s.totalStudentsSnapshot,
      inYeshivaCount: entries.filter(e => e.status === 'IN_YESHIVA').length,
      outWithPermCount: entries.filter(e => e.status === 'OUT_WITH_PERMISSION').length,
      outWithoutPermCount: entries.filter(e => e.status === 'OUT_WITHOUT_PERMISSION').length,
      markedCount: entries.length, unmarkedCount: s.totalStudentsSnapshot - entries.length,
      durationSec: Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000),
    }]
  }

  async closeAuditSession(id: string, _adminPin: string): Promise<AuditSessionWithDetails | { error: string }> {
    if (!this._mockAuditSession || this._mockAuditSession.id !== id) return { error: 'NOT_ACTIVE' }
    this._mockAuditSession = { ...this._mockAuditSession, status: 'CLOSED', closedAt: new Date().toISOString(), closedBy: 'admin' }
    return this._mockAuditSession
  }

  async submitAuditEntry(params: { sessionId: string; studentId: string; status: AuditEntryStatus; note?: string; supervisorPin: string }): Promise<AuditEntry | { error: string }> {
    if (!this._mockAuditSession || this._mockAuditSession.id !== params.sessionId) return { error: 'SESSION_NOT_FOUND' }
    if (this._mockAuditSession.status !== 'ACTIVE') return { error: 'SESSION_CLOSED' }
    const snap = this._mockAuditSession.studentSnapshot
    const snapIdx = snap.findIndex(s => s.id === params.studentId)
    if (snapIdx === -1) return { error: 'STUDENT_NOT_IN_SESSION' }
    // Server-side parity: a FINISHED class is immutable.
    const cs = this._mockAuditSession.classStates.find(c => c.classId === snap[snapIdx].classId)
    if (cs?.status === 'FINISHED') return { error: 'CLASS_FINISHED' }
    const existing = this._mockAuditSession.entries.findIndex(e => e.studentSnapshotIdx === snapIdx)
    const entry: AuditEntry = {
      id: uuidv4(), sessionId: params.sessionId, studentId: params.studentId,
      studentSnapshotIdx: snapIdx, classId: snap[snapIdx].classId, grade: snap[snapIdx].grade,
      status: params.status, note: params.note ?? null, source: 'SUPERVISOR',
      hadActiveDepartureAtAudit: false, submittedBy: 'supervisor',
      submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const entries = [...this._mockAuditSession.entries]
    if (existing >= 0) entries[existing] = entry
    else entries.push(entry)
    this._mockAuditSession = { ...this._mockAuditSession, entries }
    return entry
  }

  async finishClassAudit(params: { sessionId: string; classId: string; note?: string; supervisorPin: string }): Promise<AuditClassState | { error: string }> {
    if (!this._mockAuditSession || this._mockAuditSession.id !== params.sessionId) return { error: 'SESSION_NOT_FOUND' }
    const entries = this._mockAuditSession.entries.filter(e => e.classId === params.classId)
    const classState: AuditClassState = {
      id: uuidv4(), sessionId: params.sessionId, classId: params.classId, status: 'FINISHED',
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), finishedBy: 'supervisor',
      unmarkedAtFinish: 0, inYeshivaAtFinish: entries.filter(e => e.status === 'IN_YESHIVA').length,
      outWithPermAtFinish: entries.filter(e => e.status === 'OUT_WITH_PERMISSION').length,
      outWithoutPermAtFinish: entries.filter(e => e.status === 'OUT_WITHOUT_PERMISSION').length,
      supervisorNote: params.note ?? null, updatedAt: new Date().toISOString(),
    }
    const classStates = this._mockAuditSession.classStates.map(cs => cs.classId === params.classId ? classState : cs)
    this._mockAuditSession = { ...this._mockAuditSession, classStates }
    return classState
  }

  async bulkMarkUnmarkedAuditEntries(params: { sessionId: string; classId: string; status: AuditEntryStatus; supervisorPin: string }): Promise<{ markedCount: number } | { error: string }> {
    if (!this._mockAuditSession || this._mockAuditSession.id !== params.sessionId) return { error: 'SESSION_NOT_FOUND' }
    if (this._mockAuditSession.status !== 'ACTIVE') return { error: 'SESSION_CLOSED' }
    const cs = this._mockAuditSession.classStates.find(c => c.classId === params.classId)
    if (cs?.status === 'FINISHED') return { error: 'CLASS_FINISHED' }
    const session = this._mockAuditSession
    const existing = new Set(session.entries.map(e => e.studentSnapshotIdx))
    const fresh: AuditEntry[] = []
    session.studentSnapshot.forEach((snap, idx) => {
      if (snap.classId !== params.classId) return
      if (existing.has(idx)) return
      fresh.push({
        id: uuidv4(), sessionId: params.sessionId, studentId: snap.id, studentSnapshotIdx: idx,
        classId: snap.classId, grade: snap.grade, status: params.status, note: null,
        source: 'SUPERVISOR', hadActiveDepartureAtAudit: false, submittedBy: 'supervisor',
        submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
    })
    this._mockAuditSession = { ...session, entries: [...session.entries, ...fresh] }
    return { markedCount: fresh.length }
  }

  async submitStudentAuditGps(params: { sessionId: string; studentId: string; deviceToken: string; gpsLat: number; gpsLng: number; accuracyM?: number | null; gpsStatus?: string }): Promise<{ distanceM: number; distanceBucket: string; status: AuditEntryStatus } | { error: string }> {
    const session = this._mockAuditSession
    if (!session || session.id !== params.sessionId) return { error: 'SESSION_NOT_FOUND' }
    if (session.status !== 'ACTIVE') return { error: 'SESSION_CLOSED' }
    if (session.mode !== 'LOCATION') return { error: 'WRONG_MODE' }
    // Server-side parity: device token must match (in mock we accept any non-empty token).
    if (!params.deviceToken) return { error: 'AUTH' }
    const snapIdx = session.studentSnapshot.findIndex(s => s.id === params.studentId)
    if (snapIdx === -1) return { error: 'STUDENT_NOT_IN_SESSION' }
    const snap = session.studentSnapshot[snapIdx]
    // Server-side parity: a FINISHED class is immutable.
    const cs = session.classStates.find(c => c.classId === snap.classId)
    if (cs?.status === 'FINISHED') return { error: 'CLASS_FINISHED' }
    const CAMPUS_LAT = 31.5253, CAMPUS_LNG = 35.1056
    const toRad = (d: number) => d * Math.PI / 180
    const R = 6371000
    const dLat = toRad(params.gpsLat - CAMPUS_LAT)
    const dLng = toRad(params.gpsLng - CAMPUS_LNG)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(CAMPUS_LAT)) * Math.cos(toRad(params.gpsLat)) * Math.sin(dLng / 2) ** 2
    const distM = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
    const bucket = distM <= 300 ? 'GREEN' : distM <= 1000 ? 'BLUE' : distM <= 5000 ? 'ORANGE' : 'RED'
    const status: AuditEntryStatus = bucket === 'GREEN' ? 'IN_YESHIVA' : 'OUT_WITH_PERMISSION'
    const existing = session.entries.findIndex(e => e.studentSnapshotIdx === snapIdx)
    const entry: AuditEntry = {
      id: uuidv4(), sessionId: params.sessionId, studentId: params.studentId,
      studentSnapshotIdx: snapIdx, classId: snap.classId, grade: snap.grade,
      status, note: null, source: 'AUTO_GPS', hadActiveDepartureAtAudit: false,
      submittedBy: 'student', submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      gpsLat: params.gpsLat, gpsLng: params.gpsLng,
      gpsAccuracyM: params.accuracyM ?? null, distanceFromCampusM: distM,
      distanceBucket: bucket as AuditEntry['distanceBucket'],
      gpsStatus: (params.gpsStatus ?? 'OK') as AuditEntry['gpsStatus'],
    }
    const entries = [...session.entries]
    if (existing >= 0) entries[existing] = entry
    else entries.push(entry)
    this._mockAuditSession = { ...session, entries }
    return { distanceM: distM, distanceBucket: bucket, status }
  }
}
