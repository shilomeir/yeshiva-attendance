import { supabase } from '@/lib/supabase'
import type {
  AuditSession,
  AuditLiveBoardRow,
  AuditClassBoardRow,
  AuditAlert,
  AuditHistoryRow,
  AuditSessionClass,
  CreateAuditSessionInput,
  CreateAuditSessionResult,
  RecordLocationResponseInput,
  RecordLocationResponseResult,
  ManualMarkInput,
} from './auditTypes'

/**
 * Audit API — single entry point for all internal-audit operations.
 *
 * All writes go through SECURITY DEFINER RPCs, so anon JWT is sufficient.
 * Reads use the `v_audit_*` views which already strip lat/lng for supervisors.
 */
class AuditApi {
  // ── Session lifecycle ─────────────────────────────────────────────────────

  async getActiveSession(): Promise<AuditSession | null> {
    const { data, error } = await supabase.rpc('get_active_audit_session')
    if (error) throw error
    return (data as AuditSession | null) ?? null
  }

  async getSession(id: string): Promise<AuditSession | null> {
    const { data, error } = await supabase
      .from('audit_sessions').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return (data as AuditSession) ?? null
  }

  async createSession(input: CreateAuditSessionInput): Promise<CreateAuditSessionResult> {
    const { data, error } = await supabase.rpc('create_audit_session', {
      p_mode: input.mode,
      p_class_ids: input.classIds,
      p_title: input.title ?? null,
      p_started_by: input.startedBy ?? 'admin',
    })
    if (error) throw error
    const result = data as { sessionId?: string; participants?: number; classes?: number; reused?: boolean; error?: string }
    if (result.error) throw new Error(result.error)
    return {
      sessionId: result.sessionId!,
      participants: result.participants ?? 0,
      classes: result.classes ?? 0,
      reused: !!result.reused,
    }
  }

  async activateSession(sessionId: string): Promise<void> {
    const { data, error } = await supabase.rpc('activate_audit_session', { p_session_id: sessionId })
    if (error) throw error
    const result = data as { error?: string }
    if (result?.error) throw new Error(result.error)
  }

  async completeSession(sessionId: string, actorId = 'admin'): Promise<void> {
    const { data, error } = await supabase.rpc('complete_audit_session', {
      p_session_id: sessionId,
      p_actor_id: actorId,
    })
    if (error) throw error
    const result = data as { error?: string }
    if (result?.error) throw new Error(result.error)
  }

  async cancelSession(sessionId: string, actorId = 'admin'): Promise<void> {
    const { data, error } = await supabase.rpc('cancel_audit_session', {
      p_session_id: sessionId,
      p_actor_id: actorId,
    })
    if (error) throw error
    const result = data as { error?: string }
    if (result?.error) throw new Error(result.error)
  }

  async resolveAlert(alertId: string, actorId = 'admin'): Promise<void> {
    const { error } = await supabase.rpc('resolve_audit_alert', {
      p_alert_id: alertId,
      p_actor_id: actorId,
    })
    if (error) throw error
  }

  // ── History detail (drill-down report) ────────────────────────────────────

  async getParticipants(sessionId: string) {
    const { data, error } = await supabase
      .from('audit_participants')
      .select('*')
      .eq('session_id', sessionId)
    if (error) throw error
    return (data ?? []) as Array<import('./auditTypes').AuditParticipant>
  }

  async getLocationResponses(sessionId: string) {
    const { data, error } = await supabase
      .from('audit_location_responses')
      .select('*')
      .eq('session_id', sessionId)
    if (error) throw error
    return (data ?? []) as Array<import('./auditTypes').AuditLocationResponse>
  }

  async getManualMarks(sessionId: string) {
    const { data, error } = await supabase
      .from('audit_manual_marks')
      .select('*')
      .eq('session_id', sessionId)
    if (error) throw error
    return (data ?? []) as Array<import('./auditTypes').AuditManualMark>
  }

  // ── Live board reads ──────────────────────────────────────────────────────

  async getLiveBoard(sessionId: string): Promise<AuditLiveBoardRow[]> {
    const { data, error } = await supabase
      .from('v_audit_live_board')
      .select('*')
      .eq('session_id', sessionId)
    if (error) throw error
    return (data as AuditLiveBoardRow[]) ?? []
  }

  async getClassBoard(sessionId: string, classId: string): Promise<AuditClassBoardRow[]> {
    const { data, error } = await supabase
      .from('v_audit_class_board')
      .select('*')
      .eq('session_id', sessionId)
      .eq('class_id', classId)
    if (error) throw error
    return (data as AuditClassBoardRow[]) ?? []
  }

  async getAlerts(sessionId: string): Promise<AuditAlert[]> {
    const { data, error } = await supabase
      .from('audit_alerts')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as AuditAlert[]) ?? []
  }

  async getSessionClasses(sessionId: string): Promise<AuditSessionClass[]> {
    const { data, error } = await supabase
      .from('audit_session_classes')
      .select('*')
      .eq('session_id', sessionId)
    if (error) throw error
    return (data as AuditSessionClass[]) ?? []
  }

  // ── Student / supervisor writes ───────────────────────────────────────────

  async recordAppOpened(sessionId: string, studentId: string, deviceMeta?: Record<string, unknown> | null): Promise<void> {
    const { error } = await supabase.rpc('record_audit_app_opened', {
      p_session_id: sessionId,
      p_student_id: studentId,
      p_device_meta: deviceMeta ?? null,
    })
    if (error) throw error
  }

  async recordLocationResponse(input: RecordLocationResponseInput): Promise<RecordLocationResponseResult> {
    const { data, error } = await supabase.rpc('record_audit_location_response', {
      p_session_id: input.sessionId,
      p_student_id: input.studentId,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_accuracy: input.accuracy ?? null,
      p_gps_status: input.gpsStatus,
      p_error_message: input.errorMessage ?? null,
      p_device_meta: input.deviceMeta ?? null,
    })
    if (error) throw error
    const result = data as { error?: string } & RecordLocationResponseResult
    if (result.error) throw new Error(result.error)
    return result
  }

  async recordManualMark(input: ManualMarkInput): Promise<void> {
    const { data, error } = await supabase.rpc('record_manual_audit_mark', {
      p_session_id: input.sessionId,
      p_student_id: input.studentId,
      p_status: input.status,
      p_marked_by: input.markedBy,
      p_marked_by_role: input.markedByRole ?? 'SUPERVISOR',
      p_note: input.note ?? null,
    })
    if (error) throw error
    const result = data as { error?: string }
    if (result?.error) throw new Error(result.error)
  }

  // ── Push trigger (edge function call) ─────────────────────────────────────

  async dispatchPush(sessionId: string): Promise<{ sent: number; failed: number }> {
    const { data, error } = await supabase.functions.invoke('send-audit-push', {
      body: { sessionId },
    })
    if (error) throw error
    return data as { sent: number; failed: number }
  }

  // ── History ───────────────────────────────────────────────────────────────

  async getHistory(limit = 50): Promise<AuditHistoryRow[]> {
    const { data, error } = await supabase
      .from('v_audit_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data as AuditHistoryRow[]) ?? []
  }
}

export const auditApi = new AuditApi()
