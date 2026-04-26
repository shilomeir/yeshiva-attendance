import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db/schema'
import { notifyQueueChanged } from '@/lib/sync/syncEngine'
import type {
  Student, Event, SmsEvent, AdminOverride, RecurringAbsence,
  StudentStatus, DashboardStats, DailyPresenceData, ReasonData, HourlyData, ClassStat,
  CalendarDeparture, DepartureStatus, SubmitDepartureResult,
} from '@/types'
import type {
  IApiClient, GetStudentsOptions, SubmitDeparturePayload,
  ListDeparturesOptions, CreateEventPayload,
} from './types'

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d
}

export class SupabaseApiClient implements IApiClient {

  // ── Students ───────────────────────────────────────────────────────────────

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
    if (options?.offset) query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1)
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
    const { error } = await supabase
      .from('students')
      .update({ currentStatus: status, lastSeen: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  async updateStudentGrade(id: string, grade: string, classId: string): Promise<void> {
    const { error } = await supabase.from('students').update({ grade, classId }).eq('id', id)
    if (error) throw error
  }

  async updateStudentLocation(id: string, lat: number, lng: number): Promise<void> {
    const { error } = await supabase
      .from('students')
      .update({ lastLocation: { lat, lng }, lastSeen: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  async updateStudentFcmToken(id: string, token: string): Promise<void> {
    const { error } = await supabase.from('students').update({ fcm_token: token }).eq('id', id)
    if (error) throw error
  }

  async updatePushToken(id: string, token: string | null): Promise<void> {
    const { error } = await supabase.from('students').update({ push_token: token }).eq('id', id)
    if (error) throw error
  }

  async sendPushToAll(title: string, body: string): Promise<{ sent: number; failed: number; lastError?: string }> {
    const { data, error } = await supabase
      .from('students')
      .select('id, push_token')
      .not('push_token', 'is', null)
    if (error) throw error

    const students = (data ?? []).filter((s: { id: string; push_token: string }) => s.push_token)
    let sent = 0, failed = 0
    let lastError: string | undefined

    await Promise.all(
      students.map(async (s: { id: string; push_token: string }) => {
        try {
          const res = await supabase.functions.invoke('send-push', {
            body: { subscription: s.push_token, title, body },
          })
          const resData = res.data as { sent?: boolean; gone?: boolean; error?: string } | null
          if (res.error || resData?.sent === false) {
            failed++
            lastError = resData?.error ?? res.error?.message
            if (resData?.gone) {
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

  async deleteStudent(id: string): Promise<void> {
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) throw error
  }

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
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .neq('currentStatus', 'ON_CAMPUS')
      .lt('lastSeen', cutoff)
    if (error) throw error
    return (data as Student[]) ?? []
  }

  // ── Departures ─────────────────────────────────────────────────────────────

  async submitDeparture(payload: SubmitDeparturePayload): Promise<SubmitDepartureResult> {
    const { data, error } = await supabase.rpc('submit_departure', {
      p_student_id:    payload.studentId,
      p_start_at:      toIso(payload.startAt),
      p_end_at:        toIso(payload.endAt),
      p_reason:        payload.reason ?? null,
      p_is_urgent:     payload.isUrgent ?? false,
      p_source:        payload.source ?? 'SELF',
      p_approved_by:   payload.approvedBy ?? null,
      p_force_pending: payload.forcePending ?? false,
      p_actor_id:      payload.actorId ?? null,
      p_actor_role:    payload.actorRole ?? 'STUDENT',
    })
    if (error) throw error
    const result = data as SubmitDepartureResult

    // If the server says notifyAdmin — fire the edge function asynchronously
    if ('notifyAdmin' in result && result.notifyAdmin && 'id' in result) {
      void this._notifyAdminQuotaFull(result as { id: string; quota: number; current: number }, payload)
    }

    return result
  }

  private async _notifyAdminQuotaFull(
    result: { id: string; quota: number; current: number },
    payload: SubmitDeparturePayload,
  ): Promise<void> {
    try {
      const student = await this.getStudent(payload.studentId)
      await supabase.functions.invoke('notify-admin-quota-full', {
        body: {
          action:       'notify',
          studentName:  student?.fullName ?? payload.studentId,
          classId:      student?.classId ?? '',
          quota:        result.quota,
          current:      result.current,
          departureId:  result.id,
        },
      })
    } catch {
      // Non-fatal — admin will see it via realtime subscription
    }
  }

  async approveDeparture(
    id: string,
    actorId: string,
    actorRole: 'ADMIN' | 'SUPERVISOR' = 'ADMIN',
    note?: string,
  ): Promise<{ status: DepartureStatus } | { error: string }> {
    const { data, error } = await supabase.rpc('approve_departure', {
      p_id:         id,
      p_actor_id:   actorId,
      p_actor_role: actorRole,
      p_note:       note ?? null,
    })
    if (error) throw error
    const res = data as { status?: DepartureStatus; error?: string }

    // Send push to student on approval
    if (res.status && res.status !== ('error' as DepartureStatus)) {
      void this._sendApprovalPush(id, note)
    }

    return res as { status: DepartureStatus } | { error: string }
  }

  private async _sendApprovalPush(departureId: string, adminNote?: string): Promise<void> {
    try {
      const { data: dep } = await supabase
        .from('departures')
        .select('student_id')
        .eq('id', departureId)
        .single()
      if (!dep) return
      const { data: student } = await supabase
        .from('students')
        .select('push_token')
        .eq('id', dep.student_id)
        .single()
      if (student?.push_token) {
        await supabase.functions.invoke('send-push', {
          body: {
            subscription: student.push_token,
            title: 'בוקר טוב! היציאה שלך אושרה, לך בשלום 🎉',
            body: adminNote || 'הבקשה שלך אושרה על ידי הנהלת הישיבה',
          },
        })
      }
    } catch {
      // Non-fatal
    }
  }

  async rejectDeparture(
    id: string,
    actorId: string,
    actorRole: 'ADMIN' | 'SUPERVISOR' = 'ADMIN',
    note?: string,
  ): Promise<{ status: 'REJECTED' } | { error: string }> {
    const { data, error } = await supabase.rpc('reject_departure', {
      p_id:         id,
      p_actor_id:   actorId,
      p_actor_role: actorRole,
      p_note:       note ?? null,
    })
    if (error) throw error
    return data as { status: 'REJECTED' } | { error: string }
  }

  async cancelDeparture(
    id: string,
    actorId: string,
    actorRole: 'STUDENT' | 'ADMIN' | 'SUPERVISOR' = 'STUDENT',
    note?: string,
  ): Promise<{ status: 'CANCELLED' } | { error: string }> {
    const { data, error } = await supabase.rpc('cancel_departure', {
      p_id:         id,
      p_actor_id:   actorId,
      p_actor_role: actorRole,
      p_note:       note ?? null,
    })
    if (error) throw error
    return data as { status: 'CANCELLED' } | { error: string }
  }

  async returnDeparture(
    id: string,
    studentId?: string,
    gpsLat?: number,
    gpsLng?: number,
  ): Promise<{ status: 'COMPLETED' } | { error: string }> {
    const { data, error } = await supabase.rpc('return_departure', {
      p_id:         id,
      p_student_id: studentId ?? null,
      p_gps_lat:    gpsLat ?? null,
      p_gps_lng:    gpsLng ?? null,
    })
    if (error) throw error
    return data as { status: 'COMPLETED' } | { error: string }
  }

  async listDepartures(options?: ListDeparturesOptions): Promise<CalendarDeparture[]> {
    let query = supabase
      .from('v_calendar_departures')
      .select('*')
      .order('start_at', { ascending: false })

    if (options?.studentId) query = query.eq('student_id', options.studentId)
    if (options?.classId) query = query.eq('class_id', options.classId)
    if (options?.grade) query = query.eq('grade', options.grade)

    if (options?.status) {
      if (Array.isArray(options.status)) {
        query = query.in('status', options.status)
      } else {
        query = query.eq('status', options.status)
      }
    }

    if (options?.from) query = query.gte('end_at', toIso(options.from))
    if (options?.to) query = query.lte('start_at', toIso(options.to))
    if (options?.limit) query = query.limit(options.limit)

    const { data, error } = await query
    if (error) throw error
    return (data as CalendarDeparture[]) ?? []
  }

  async tickDepartures(): Promise<number> {
    const { data, error } = await supabase.rpc('tick_departures')
    if (error) throw error
    return (data as number) ?? 0
  }

  // ── Events (audit log) ─────────────────────────────────────────────────────

  async getEvents(studentId: string): Promise<Event[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('studentId', studentId)
      .order('timestamp', { ascending: false })
    if (error) throw error
    return (data as Event[]) ?? []
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

    const newStatus: StudentStatus = payload.type === 'CHECK_IN' ? 'ON_CAMPUS' : 'OFF_CAMPUS'
    const locationUpdate = payload.gpsLat && payload.gpsLng
      ? { lastLocation: { lat: payload.gpsLat, lng: payload.gpsLng } }
      : {}

    if (!navigator.onLine) {
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

    const { data, error } = await supabase
      .from('events')
      .insert({ ...event, syncedAt: now })
      .select()
      .single()
    if (error) throw error

    await supabase
      .from('students')
      .update({ lastSeen: now, currentStatus: newStatus, ...locationUpdate })
      .eq('id', payload.studentId)

    return data as Event
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) throw error
  }

  async getRecentEvents(limit = 50): Promise<Event[]> {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data as Event[]) ?? []
  }

  // ── SMS ────────────────────────────────────────────────────────────────────

  async getSmsEvents(): Promise<import('@/types').SmsEvent[]> {
    const { data, error } = await supabase
      .from('sms_events')
      .select('*')
      .order('timestamp', { ascending: false })
    if (error) throw error
    return (data as import('@/types').SmsEvent[]) ?? []
  }

  async createSmsEvent(raw: string, _studentPhone?: string): Promise<import('@/types').SmsEvent> {
    const smsEvent = {
      id: uuidv4(), studentId: null, rawMessage: raw,
      parsedCorrectly: false, parsedType: null, parsedTime: null,
      parsedReason: null, timestamp: new Date().toISOString(), webhookError: null,
    }
    const { data, error } = await supabase.from('sms_events').insert(smsEvent).select().single()
    if (error) throw error
    return data as import('@/types').SmsEvent
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  async getAdminOverrides(): Promise<AdminOverride[]> {
    const { data, error } = await supabase
      .from('admin_overrides')
      .select('*')
      .order('timestamp', { ascending: false })
    if (error) throw error
    return (data as AdminOverride[]) ?? []
  }

  async createAdminOverride(studentId: string, newStatus: StudentStatus, note?: string): Promise<AdminOverride> {
    // Capture previousStatus BEFORE any side effects so the audit record is accurate.
    // (submitDeparture and cancelDeparture both mutate students.currentStatus server-side.)
    const studentBefore = await this.getStudent(studentId)
    const previousStatus = studentBefore?.currentStatus ?? 'ON_CAMPUS'

    if (newStatus === 'OFF_CAMPUS') {
      // Cancel any live departures first to avoid the GiST EXCLUDE overlap constraint.
      const liveDeps = await this.listDepartures({
        studentId,
        status: ['PENDING', 'APPROVED', 'ACTIVE'],
      })
      for (const dep of liveDeps) {
        const cancelResult = await this.cancelDeparture(dep.id, 'admin', 'ADMIN', 'בוטל עקב עקיפת סטטוס ידנית')
        if ('error' in cancelResult) {
          const r = cancelResult as { error: string; message?: string }
          throw new Error(r.message ?? r.error)
        }
      }

      // Create a departure with ADMIN_OVERRIDE source (valid until end of day by default)
      const startAt = new Date()
      const endAt = new Date()
      endAt.setHours(23, 59, 0, 0)
      if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1)

      const result = await this.submitDeparture({
        studentId,
        startAt,
        endAt,
        reason: note ?? null,
        source: 'ADMIN_OVERRIDE',
        actorId: 'admin',
        actorRole: 'ADMIN',
      })

      if ('error' in result) {
        const r = result as { error: string; message?: string }
        throw new Error(r.message ?? r.error)
      }
    } else if (newStatus === 'ON_CAMPUS') {
      // Cancel any active departure for this student
      const activeDeps = await this.listDepartures({ studentId, status: 'ACTIVE' })
      for (const dep of activeDeps) {
        const cancelResult = await this.cancelDeparture(dep.id, 'admin', 'ADMIN', note)
        if ('error' in cancelResult) {
          const r = cancelResult as { error: string; message?: string }
          throw new Error(r.message ?? r.error)
        }
      }
    } else {
      // Direct status update for other statuses (e.g. resetting PENDING)
      await this.updateStudentStatus(studentId, newStatus)
    }

    // Write explicit audit record for direct admin override
    const override = {
      id: uuidv4(),
      studentId,
      adminId: 'admin',
      action: 'manual_override',
      previousStatus,
      newStatus,
      timestamp: new Date().toISOString(),
      note: note ?? null,
    }
    const { data, error } = await supabase.from('admin_overrides').insert(override).select().single()
    if (error) throw error
    return data as AdminOverride
  }

  // ── Recurring absences ────────────────────────────────────────────────────

  async getRecurringAbsences(studentId: string): Promise<RecurringAbsence[]> {
    const { data, error } = await supabase
      .from('recurring_absences')
      .select('*')
      .eq('studentId', studentId)
    if (error) throw error
    return (data as RecurringAbsence[]) ?? []
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    const { data, error } = await supabase
      .from('students')
      .select('currentStatus, pendingApproval, lastSeen')
    if (error) throw error
    const students = (data ?? []) as Array<{ currentStatus: string; pendingApproval: boolean; lastSeen: string | null }>
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const onCampus  = students.filter(s => s.currentStatus === 'ON_CAMPUS').length
    const offCampus = students.filter(s => s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE').length
    return {
      // Exclude PENDING-status students from total so the on-campus % reflects active students only
      total:     onCampus + offCampus,
      onCampus,
      offCampus,
      pending:   students.filter(s => s.pendingApproval).length,
      longAbsent: students.filter(s =>
        s.currentStatus !== 'ON_CAMPUS' && s.lastSeen && s.lastSeen < sevenDaysAgo
      ).length,
    }
  }

  async getDailyPresence(days = 30): Promise<DailyPresenceData[]> {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const { data, error } = await supabase
      .from('events')
      .select('studentId, type, timestamp')
      .gte('timestamp', since.toISOString())
      .order('timestamp', { ascending: true })
    if (error) throw error
    const dailyMap = new Map<string, { onCampus: Set<string>; offCampus: Set<string> }>()
    for (const event of (data ?? []) as Array<{ studentId: string; type: string; timestamp: string }>) {
      const date = event.timestamp.slice(0, 10)
      if (!dailyMap.has(date)) dailyMap.set(date, { onCampus: new Set(), offCampus: new Set() })
      const day = dailyMap.get(date)!
      if (event.type === 'CHECK_IN') day.onCampus.add(event.studentId)
      else if (event.type === 'CHECK_OUT') day.offCampus.add(event.studentId)
    }
    return Array.from(dailyMap.entries()).map(([date, { onCampus, offCampus }]) => ({
      date, onCampus: onCampus.size, offCampus: offCampus.size,
    }))
  }

  async getReasonBreakdown(): Promise<ReasonData[]> {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    // Read from departures for richer data (includes all sources)
    const { data, error } = await supabase
      .from('departures')
      .select('reason')
      .gte('created_at', since.toISOString())
      .not('reason', 'is', null)
    if (error) throw error
    const map = new Map<string, number>()
    for (const d of (data ?? []) as Array<{ reason: string }>) {
      const r = d.reason || 'אחר'
      map.set(r, (map.get(r) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
  }

  async getHourlyDepartures(): Promise<HourlyData[]> {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const { data, error } = await supabase
      .from('departures')
      .select('start_at')
      .gte('created_at', since.toISOString())
    if (error) throw error
    const hourMap = new Map<number, number>()
    for (let h = 0; h < 24; h++) hourMap.set(h, 0)
    for (const d of (data ?? []) as Array<{ start_at: string }>) {
      const hour = new Date(d.start_at).getHours()
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1)
    }
    return Array.from(hourMap.entries()).map(([hour, count]) => ({ hour, count }))
  }

  async getClassStats(): Promise<ClassStat[]> {
    const { data, error } = await supabase
      .from('students')
      .select('grade, classId, currentStatus')
    if (error) throw error
    const map = new Map<string, ClassStat>()
    for (const s of (data ?? []) as Array<{ grade: string; classId: string; currentStatus: string }>) {
      const key = `${s.grade}|${s.classId}`
      if (!map.has(key)) map.set(key, { grade: s.grade, classId: s.classId, total: 0, onCampus: 0, offCampus: 0 })
      const stat = map.get(key)!
      stat.total++
      if (s.currentStatus === 'ON_CAMPUS') stat.onCampus++
      else if (s.currentStatus === 'OFF_CAMPUS' || s.currentStatus === 'OVERDUE') stat.offCampus++
    }
    return Array.from(map.values())
  }
}
