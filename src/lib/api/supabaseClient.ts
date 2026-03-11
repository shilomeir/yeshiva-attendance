import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import type {
  Student, Event, SmsEvent, AdminOverride, AbsenceRequest, RecurringAbsence,
  StudentStatus, DashboardStats, DailyPresenceData, ReasonData, HourlyData, ClassStat,
} from '@/types'
import type { IApiClient, GetStudentsOptions, CreateEventPayload, CreateAbsenceRequestPayload } from './types'

export class SupabaseApiClient implements IApiClient {
  async getStudents(options?: GetStudentsOptions): Promise<Student[]> {
    let query = supabase.from('students').select('*')
    if (options?.filter === 'OFF_CAMPUS') query = query.eq('currentStatus', 'OFF_CAMPUS')
    else if (options?.filter === 'PENDING') query = query.eq('pendingApproval', true)
    else if (options?.filter === 'OVERDUE') query = query.eq('currentStatus', 'OVERDUE')
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
    const event = {
      id: uuidv4(), studentId: payload.studentId, type: payload.type, timestamp: now,
      reason: payload.reason ?? null, expectedReturn: payload.expectedReturn ?? null,
      gpsLat: payload.gpsLat ?? null, gpsLng: payload.gpsLng ?? null, gpsStatus: payload.gpsStatus ?? 'PENDING',
      distanceFromCampus: payload.distanceFromCampus ?? null, note: payload.note ?? null, syncedAt: now,
    }
    const { data, error } = await supabase.from('events').insert(event).select().single()
    if (error) throw error

    // Update student's last known location and lastSeen timestamp
    const studentUpdate: Record<string, unknown> = { lastSeen: now }
    if (payload.gpsLat && payload.gpsLng) {
      studentUpdate.lastLocation = { lat: payload.gpsLat, lng: payload.gpsLng }
    }
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
    const override = { id: uuidv4(), studentId, adminId: 'admin', action: 'manual_override', previousStatus: 'ON_CAMPUS' as StudentStatus, newStatus, timestamp: new Date().toISOString(), note: note ?? null }
    const { data, error } = await supabase.from('admin_overrides').insert(override).select().single()
    if (error) throw error
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
    const request = { id: uuidv4(), studentId: payload.studentId, date: payload.date, endDate: payload.endDate ?? null, reason: payload.reason, startTime: payload.startTime, endTime: payload.endTime, status: 'PENDING' as const, adminNote: null, isUrgent: payload.isUrgent ?? false, createdAt: new Date().toISOString() }
    const { data, error } = await supabase.from('absence_requests').insert(request).select().single()
    if (error) throw error
    return data as AbsenceRequest
  }

  async updateAbsenceRequestStatus(id: string, status: AbsenceRequest['status'], adminNote?: string): Promise<void> {
    const { error } = await supabase.from('absence_requests').update({ status, adminNote: adminNote ?? null }).eq('id', id)
    if (error) throw error
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

  async addStudent(data: { fullName: string; idNumber: string; phone: string; grade: string; classId: string }): Promise<Student> {
    const student = {
      id: uuidv4(), fullName: data.fullName, idNumber: data.idNumber, phone: data.phone,
      deviceToken: null, currentStatus: 'ON_CAMPUS' as StudentStatus, lastSeen: null, lastLocation: null,
      pendingApproval: false, createdAt: new Date().toISOString(), grade: data.grade, classId: data.classId,
    }
    const { data: created, error } = await supabase.from('students').insert(student).select().single()
    if (error) throw error
    return created as Student
  }

  async deleteStudent(id: string): Promise<void> {
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) throw error
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
      offCampus: students.filter(s => s.currentStatus === 'OFF_CAMPUS').length,
      overdue: students.filter(s => s.currentStatus === 'OVERDUE').length,
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
      if (!map.has(key)) map.set(key, { grade: s.grade, classId: s.classId, total: 0, onCampus: 0, offCampus: 0, overdue: 0 })
      const stat = map.get(key)!
      stat.total++
      if (s.currentStatus === 'ON_CAMPUS') stat.onCampus++
      else if (s.currentStatus === 'OFF_CAMPUS') stat.offCampus++
      else if (s.currentStatus === 'OVERDUE') stat.overdue++
    }
    return Array.from(map.values())
  }
             }
