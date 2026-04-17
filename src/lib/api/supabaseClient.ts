import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db/schema'
import { notifyQueueChanged } from '@/lib/sync/syncEngine'
import type {
  Student, Event, SmsEvent, AdminOverride, AbsenceRequest, RecurringAbsence,
  StudentStatus, DashboardStats, DailyPresenceData, ReasonData, HourlyData, ClassStat,
} from '@/types'
import type { IApiClient, GetStudentsOptions, CreateEventPayload, CreateAbsenceRequestPayload, QuotaCheckResult } from './types'

export class SupabaseApiClient implements IApiClient {
  async getStudents(options?: GetStudentsOptions): Promise<Student[]> {
    let query = supabase.from('students').select('*')
    if (options?.filter === 'OFF_CAMPUS') query = query.in('currentStatus', ['OFF_CAMPUS', 'OVERDUE'])
    else if (options?.filter === 'PENDING') query = query.eq('pendingApproval', true)
    if (options?.grade) query = query.eq('grade', options.grade)
    if (options?.classId) query = query.eq('classId', options.classId)
    if (options?.search) {
      const q = options.search
      query = query.or(`fullName.ilike.%${q}%,idNumber.ilike.%${q}%,phone.ilike.%${q}%`)
    }
    if (options?.limit) query = query.limit(options.limit)
    const { data, error } = await query.order('fullName')
    if (error) throw error
    return (data as Student[]) ?? []
  }

  async getStudent(id: string): Promise<Student | null> {
    const { data, error } = await supabase.from('students').select('*').eq('id', id).single()
    if (error) return null
    return data as Student
  }

  async getStudentsByIds(ids: string[]): Promise<Record<string, Student>> {
    if (ids.length === 0) return {}
    const { data, error } = await supabase
      .from('students')
      .select('id, fullName, classId, grade, currentStatus, idNumber, phone')
      .in('id', ids)
    if (error) throw error
    return Object.fromEntries((data as Student[]).map((s) => [s.id, s]))
  }

  async getStudentByIdNumber(idNumber: string): Promise<Student | null> {
    const { data, error } = await supabase.from('students').select('*').eq('idNumber', idNumber).single()
    if (error) return null
    return data as Student
  }

  async updateStudentStatus(id: string, status: StudentStatus): Promise<void> {
    const { error } = await supabase.from('students').update({ currentStatus: status, lastSeen: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  }

  async updateStudentGrade(id: string, grade: string, classId: string): Promise<void> {
    const { error } = await supabase.from('students').update({ grade, classId }).eq('id', id)
    if (error) throw error
  }

  async getEvents(studentId: string): Promise<Event[]> {
    const { data, error } = await supabase.from('events').select('*').eq('studentId', studentId).order('timestamp', { ascending: false })
    if (error) throw error
    return (data as Event[]) ?? []
  }

  async createEvent(payload: CreateEventPayload): Promise<Event> {
    const now = new Date().toISOString()
    const event: Event = {
      id: uuidv4(), studentId: payload.studentId, type: payload.type, timestamp: now,
      reason: payload.reason ?? null, expectedReturn: payload.expectedReturn ?? null,
      gpsLat: payload.gpsLat ?? null, gpsLng: payload.gpsLng ?? null, gpsStatus: payload.gpsStatus ?? 'PENDING',
      distanceFromCampus: payload.distanceFromCampus ?? null, note: payload.note ?? null, syncedAt: null,
    }

    const newStatus: StudentStatus = payload.type === 'CHECK_IN' ? 'ON_CAMPUS' : 'OFF_CAMPUS'
    const locationUpdate = payload.gpsLat && payload.gpsLng
      ? { lastLocation: { lat: payload.gpsLat, lng: payload.gpsLng } }
      : {}

    if (!navigator.onLine) {
      // Offline path — persist locally and queue for sync when back online
      await db.events.put(event)
      await db.students.update(payload.studentId, { currentStatus: newStatus, lastSeen: now, ...locationUpdate })
      await db.syncQueue.add({
        id: uuidv4(), tableName: 'events', operation: 'INSERT',
        payload: event as unknown as Record<string, unknown>,
        clientTimestamp: now, retryCount: 0,
      })
      await db.syncQueue.add({
        id: uuidv4(), tableName: 'students', operation: 'UPDATE',
        payload: { id: payload.studentId, currentStatus: newStatus, lastSeen: now, ...locationUpdate } as Record<string, unknown>,
        clientTimestamp: now, retryCount: 0,
      })
      await notifyQueueChanged()
      return event
    }

    // Online path — write directly to Supabase
    const { data, error } = await supabase.from('events').insert({ ...event, syncedAt: now }).select().single()
    if (error) throw error

    const studentUpdate: Record<string, unknown> = { lastSeen: now, currentStatus: newStatus, ...locationUpdate }
    await supabase.from('students').update(studentUpdate).eq('id', payload.studentId)

    return data as Event
  }

  async updateStudentLocation(id: string, lat: number, lng: number): Promise<void> {
    const { error } = await supabase
      .from('students')
      .update({ lastLocation: { lat, lng }, lastSeen: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  async updateStudentFcmToken(id: string, token: string): Promise<void> {
    const { error } = await supabase
      .from('students')
      .update({ fcm_token: token })
      .eq('id', id)
    if (error) throw error
  }

  async updatePushToken(id: string, token: string | null): Promise<void> {
    const { error } = await supabase
      .from('students')
      .update({ push_token: token })
      .eq('id', id)
    if (error) throw error
  }

  async sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }> {
    const { data, error } = await supabase
      .from('students')
      .select('id, push_token')
      .not('push_token', 'is', null)
    if (error) throw error

    const students = (data ?? []).filter((s: { id: string; push_token: string }) => s.push_token)
    let sent = 0
    let failed = 0
    let lastError: string | undefined

    await Promise.all(
      students.map(async (s: { id: string; push_token: string }) => {
        try {
          const res = await supabase.functions.invoke('send-push', {
            body: { subscription: s.push_token, title, body },
          })
          const resData = res.data as { sent?: boolean; gone?: boolean; error?: string } | null
          if (res.error) {
            // Edge function itself failed (e.g. VAPID keys missing)
            failed++
            lastError = resData?.error ?? res.error?.message ?? JSON.stringify(res.error)
          } else if (resData?.sent === false) {
            // Push service rejected the notification
            failed++
            lastError = resData?.error
            if (resData?.gone) {
              // Subscription expired or unregistered — remove stale token
              await supabase.from('students').update({ push_token: null }).eq('id', s.id)
            }
          } else {
            sent++
          }
        } catch (e) {
          failed++
          lastError = e instanceof Error ? e.message : String(e)
        }
      })
    )

    return { sent, failed, lastError }
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) throw error
  }

  async getRecentEvents(limit = 50): Promise<Event[]> {
    const { data, error } = await supabase.from('events').select('*').order('timestamp', { ascending: false }).limit(limit)
    if (error) throw error
    return (data as Event[]) ?? []
  }

  async getSmsEvents(): Promise<SmsEvent[]> {
    const { data, error } = await supabase.from('sms_events').select('*').order('timestamp', { ascending: false })
    if (error) throw error
    return (data as SmsEvent[]) ?? []
  }

  async createSmsEvent(raw: string, _studentPhone?: string): Promise<SmsEvent> {
    const smsEvent = { id: uuidv4(), studentId: null, rawMessage: raw, parsedCorrectly: false, parsedType: null, parsedTime: null, parsedReason: null, timestamp: new Date().toISOString(), webhookError: null }
    const { data, error } = await supabase.from('sms_events').insert(smsEvent).select().single()
    if (error) throw error
    return data as SmsEvent
  }

  async getAdminOverrides(): Promise<AdminOverride[]> {
    const { data, error } = await supabase.from('admin_overrides').select('*').order('timestamp', { ascending: false })
    if (error) throw error
    return (data as AdminOverride[]) ?? []
  }

  async createAdminOverride(studentId: string, newStatus: StudentStatus, note?: string): Promise<AdminOverride> {
    const student = await this.getStudent(studentId)
    const previousStatus: StudentStatus = student?.currentStatus ?? 'ON_CAMPUS'
    const override = { id: uuidv4(), studentId, adminId: 'admin', action: 'manual_override', previousStatus, newStatus, timestamp: new Date().toISOString(), note: note ?? null }
    const { data, error } = await supabase.from('admin_overrides').insert(override).select().single()
    if (error) throw error
    await supabase.from('students').update({ currentStatus: newStatus }).eq('id', studentId)
    return data as AdminOverride
  }

  async getAbsenceRequests(options?: { studentId?: string; status?: AbsenceRequest['status'] }): Promise<AbsenceRequest[]> {
    let query = supabase.from('absence_requests').select('*').order('createdAt', { ascending: false })
    if (options?.studentId) query = query.eq('studentId', options.studentId)
    if (options?.status) query = query.eq('status', options.status)
    const { data, error } = await query
    if (error) throw error
    return (data as AbsenceRequest[]) ?? []
  }

  async createAbsenceRequest(payload: CreateAbsenceRequestPayload): Promise<AbsenceRequest> {
    const isUrgent = payload.isUrgent ?? false
    let status: 'PENDING' | 'APPROVED' = 'PENDING'

    if (!isUrgent) {
      // Auto-approve if quota allows; stay PENDING if full (admin must override)
      try {
        const student = await this.getStudent(payload.studentId)
        if (student) {
          const quotaData = await this.checkAbsenceQuota(
            student.classId,
            payload.date,
            payload.endDate ?? null,
            payload.startTime,
            payload.endTime,
            payload.studentId,
          )
          if (quotaData.hasSpace) status = 'APPROVED'
        }
      } catch {
        // Quota check failed — fall through to PENDING for safety
      }
    }

    const request = {
      id: uuidv4(),
      studentId: payload.studentId,
      date: payload.date,
      endDate: payload.endDate ?? null,
      reason: payload.reason,
      startTime: payload.startTime,
      endTime: payload.endTime,
      status,
      adminNote: null,
      isUrgent,
      createdAt: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('absence_requests').insert(request).select().single()
    if (error) throw error

    // If auto-approved and departure time has already passed → checkout immediately
    if (status === 'APPROVED') {
      const nowStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      const todayStr = new Date().toISOString().slice(0, 10)
      if (payload.date <= todayStr && payload.startTime <= nowStr) {
        void supabase.rpc('auto_checkout_students')
      }
    }

    return data as AbsenceRequest
  }

  async checkAbsenceQuota(
    classId: string,
    date: string,
    endDate: string | null,
    startTime: string,
    endTime: string,
    excludeStudentId?: string,
  ): Promise<import('./types').AbsenceQuotaResult> {
    const { data, error } = await supabase.rpc('check_absence_quota', {
      p_class_id: classId,
      p_date: date,
      p_end_date: endDate ?? date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_exclude_student_id: excludeStudentId ?? null,
    })
    if (error) throw error
    return data as import('./types').AbsenceQuotaResult
  }

  async autoCheckoutStudents(): Promise<number> {
    const { data, error } = await supabase.rpc('auto_checkout_students')
    if (error) throw error
    return (data as number) ?? 0
  }

  async updateAbsenceRequestStatus(id: string, status: AbsenceRequest['status'], adminNote?: string): Promise<void> {
    // Fetch request first to get studentId for audit log
    const { data: req } = await supabase.from('absence_requests').select('studentId').eq('id', id).single()

    const { error } = await supabase.from('absence_requests').update({ status, adminNote: adminNote ?? null }).eq('id', id)
    if (error) throw error

    // Send push notification when request is approved
    if (status === 'APPROVED' && req) {
      try {
        const { data: studentData } = await supabase
          .from('students')
          .select('push_token')
          .eq('id', req.studentId)
          .single()
        if (studentData?.push_token) {
          await supabase.functions.invoke('send-push', {
            body: {
              subscription: studentData.push_token,
              title: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉',
              body: adminNote || 'הבקשה שלך אושרה על ידי הנהלת הישיבה',
            },
          })
        }
      } catch (pushErr) {
        // Non-fatal — approval already succeeded
        console.warn('[Push] Failed to send approval notification:', pushErr)
      }
    }

    // Create audit record for approve / reject / cancel actions
    if ((status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED') && req) {
      const student = await this.getStudent(req.studentId)
      const currentStatus = student?.currentStatus ?? 'ON_CAMPUS'
      const auditNote = adminNote
        ? adminNote
        : status === 'APPROVED' ? 'בקשת היעדרות אושרה'
        : status === 'REJECTED' ? 'בקשת היעדרות נדחתה'
        : 'בקשת היעדרות בוטלה ע"י מנהל'
      const action = status === 'APPROVED' ? 'approve_absence_request'
        : status === 'REJECTED' ? 'reject_absence_request'
        : 'cancel_absence_request'
      await supabase.from('admin_overrides').insert({
        id: uuidv4(),
        studentId: req.studentId,
        adminId: 'admin',
        action,
        previousStatus: currentStatus,
        newStatus: currentStatus,
        timestamp: new Date().toISOString(),
        note: auditNote,
      })
    }
  }

  async getUrgentRequests(): Promise<AbsenceRequest[]> {
    const { data, error } = await supabase.from('absence_requests').select('*').eq('isUrgent', true).eq('status', 'PENDING').order('createdAt', { ascending: false })
    if (error) throw error
    return (data as AbsenceRequest[]) ?? []
  }

  async getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]> {
    const { data, error } = await supabase.from('recurring_absences').select('*').eq('studentId', studentId)
    if (error) throw error
    return (data as RecurringAbsence[]) ?? []
  }

  // Students are managed exclusively via Google Sheets sync.
  // addStudent is intentionally removed — do not add it back.

  async deleteStudent(id: string): Promise<void> {
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) throw error
  }

  /** Count all students enrolled in a given class (for dynamic quota calculation). */
  async getClassSize(classId: string): Promise<number> {
    const { count, error } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('classId', classId)
    if (error) throw error
    return count ?? 0
  }

  async getLongAbsentStudents(days = 7): Promise<Student[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase.from('students').select('*').neq('currentStatus', 'ON_CAMPUS').lt('lastSeen', cutoff)
    if (error) throw error
    return (data as Student[]) ?? []
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const { data, error } = await supabase.from('students').select('currentStatus, pendingApproval, lastSeen')
    if (error) throw error
    const students = (data ?? []) as any[]
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    return {
      total: students.length,
      onCampus: students.filter(s => s.currentStatus === 'ON_CAMPUS').length,
      // OVERDUE treated as off-campus
      offCampus: students.filter(s => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length,
      pending: students.filter(s => s.pendingApproval).length,
      longAbsent: students.filter(s => s.currentStatus !== 'ON_CAMPUS' && s.lastSeen && s.lastSeen < sevenDaysAgo).length,
    }
  }

  async getDailyPresence(days = 30): Promise<DailyPresenceData[]> {
    const since = new Date(); since.setDate(since.getDate() - days)
    const { data, error } = await supabase.from('events').select('studentId, type, timestamp').gte('timestamp', since.toISOString()).order('timestamp', { ascending: true })
    if (error) throw error
    const dailyMap = new Map<string, { onCampus: Set<string>; offCampus: Set<string> }>()
    for (const event of (data ?? []) as any[]) {
      const date = event.timestamp.slice(0, 10)
      if (!dailyMap.has(date)) dailyMap.set(date, { onCampus: new Set(), offCampus: new Set() })
      const day = dailyMap.get(date)!
      if (event.type === 'CHECK_IN') day.onCampus.add(event.studentId)
      else if (event.type === 'CHECK_OUT') day.offCampus.add(event.studentId)
    }
    return Array.from(dailyMap.entries()).map(([date, { onCampus, offCampus }]) => ({ date, onCampus: onCampus.size, offCampus: offCampus.size }))
  }

  async getReasonBreakdown(): Promise<ReasonData[]> {
    const since = new Date(); since.setDate(since.getDate() - 30)
    const { data, error } = await supabase.from('events').select('reason').eq('type', 'CHECK_OUT').gte('timestamp', since.toISOString()).not('reason', 'is', null)
    if (error) throw error
    const map = new Map<string, number>()
    for (const e of (data ?? []) as any[]) { const r = e.reason || 'אחר'; map.set(r, (map.get(r) ?? 0) + 1) }
    return Array.from(map.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  }

  async getHourlyDepartures(): Promise<HourlyData[]> {
    const since = new Date(); since.setDate(since.getDate() - 30)
    const { data, error } = await supabase.from('events').select('timestamp').eq('type', 'CHECK_OUT').gte('timestamp', since.toISOString())
    if (error) throw error
    const hourMap = new Map<number, number>()
    for (let h = 0; h < 24; h++) hourMap.set(h, 0)
    for (const e of (data ?? []) as any[]) { const hour = new Date(e.timestamp).getHours(); hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1) }
    return Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count }))
  }

  async getClassStats(): Promise<ClassStat[]> {
    const { data, error } = await supabase.from('students').select('grade, classId, currentStatus')
    if (error) throw error
    const map = new Map<string, ClassStat>()
    for (const s of (data ?? []) as any[]) {
      const key = `${s.grade}|${s.classId}`
      if (!map.has(key)) map.set(key, { grade: s.grade, classId: s.classId, total: 0, onCampus: 0, offCampus: 0 })
      const stat = map.get(key)!
      stat.total++
      if (s.currentStatus === 'ON_CAMPUS') stat.onCampus++
      else if (s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE') stat.offCampus++
    }
    return Array.from(map.values())
  }

  async getClassOutsideCount(classId: string): Promise<number> {
    // Count students currently outside — but exclude those who left via an approved urgent request
    // (urgent requests don't consume a quota slot)
    const { data: outsideStudents, error } = await supabase
      .from('students')
      .select('id')
      .eq('classId', classId)
      .in('currentStatus', ['OFF_CAMPUS', 'OVERDUE'])
    if (error) throw error
    if (!outsideStudents || outsideStudents.length === 0) return 0

    const today = new Date().toISOString().split('T')[0]
    const outsideIds = outsideStudents.map((s) => s.id)

    // Find students outside because of an approved urgent exception today → they don't count
    const { data: urgentApproved } = await supabase
      .from('absence_requests')
      .select('studentId')
      .in('studentId', outsideIds)
      .eq('isUrgent', true)
      .eq('status', 'APPROVED')
      .eq('date', today)

    const urgentExemptIds = new Set((urgentApproved ?? []).map((r: { studentId: string }) => r.studentId))
    return outsideStudents.filter((s) => !urgentExemptIds.has(s.id)).length
  }

  async cancelAbsenceRequest(id: string): Promise<void> {
    const { error } = await supabase.from('absence_requests').update({ status: 'CANCELLED' }).eq('id', id)
    if (error) throw error
  }

  async markOverdueStudents(): Promise<number> {
    // OVERDUE status removed — no longer used
    return 0
  }

  async autoReturnStudents(): Promise<number> {
    const { data, error } = await supabase.rpc('auto_return_students')
    if (error) throw error
    return (data as number) ?? 0
  }

  async createCheckoutWithQuotaCheck(
    studentId: string,
    classId: string,
    grade: string,
    reason: string | null,
    expectedReturn: string | null
  ): Promise<QuotaCheckResult> {
    const { data, error } = await supabase.rpc('create_checkout_with_quota_check', {
      p_student_id: studentId,
      p_class_id: classId,
      p_grade: grade,
      p_reason: reason,
      p_expected_return: expectedReturn,
    })
    if (error) throw error
    return data as QuotaCheckResult
  }
}
