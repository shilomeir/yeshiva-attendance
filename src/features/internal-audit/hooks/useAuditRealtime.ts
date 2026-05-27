import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface UseAuditRealtimeOptions {
  sessionId: string | null
  onAnyChange: () => void
}

/**
 * Mirrors useDeparturesRealtime — single shared channel for audit tables,
 * scoped to a session_id filter so each session has its own channel.
 *
 * Listens on all four mutable tables. Caller only needs to invalidate on
 * any change; we don't expose granular insert/update/delete hooks since
 * everything in the live board is driven by view re-fetches.
 */
export function useAuditRealtime({ sessionId, onAnyChange }: UseAuditRealtimeOptions) {
  const cbRef = useRef(onAnyChange)
  useEffect(() => { cbRef.current = onAnyChange })

  useEffect(() => {
    if (!sessionId) return
    const filter = `session_id=eq.${sessionId}`
    const channel = supabase
      .channel(`audit-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_sessions',          filter: `id=eq.${sessionId}` }, () => cbRef.current?.())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_location_responses', filter }, () => cbRef.current?.())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_manual_marks',       filter }, () => cbRef.current?.())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_alerts',             filter }, () => cbRef.current?.())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [sessionId])
}
