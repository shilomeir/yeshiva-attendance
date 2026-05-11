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
}
