import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Audit realtime subscription manager (master plan R-11).
 *
 * Mirrors the existing departures pattern: ONE Supabase realtime channel
 * per session id, shared across all hooks. Multiple subscribers register
 * a callback against the same session; the channel itself stays alive
 * while at least one subscriber is referencing it, and is torn down when
 * the last subscriber unregisters.
 *
 * Channel name: `inspection:<sessionId>` — collision-free across sessions
 * so two admin tabs watching different sessions don't share filters.
 *
 * The channel applies the master plan R-35 server-side filters
 * (id=eq.<sid> on audit_sessions, session_id=eq.<sid> on audit_entries
 * and audit_class_states) so the client only receives events for the
 * relevant session.
 *
 * Usage:
 *
 *   const unsubscribe = subscribeToAuditSession(sessionId, refreshFn)
 *   // ...later
 *   unsubscribe()
 */

interface ChannelEntry {
  channel: RealtimeChannel
  callbacks: Set<() => void>
}

const channels = new Map<string, ChannelEntry>()

export function subscribeToAuditSession(
  sessionId: string,
  onChange: () => void,
): () => void {
  let entry = channels.get(sessionId)
  if (!entry) {
    const callbacks = new Set<() => void>()
    const channel = supabase
      .channel(`inspection:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'audit_sessions', filter: `id=eq.${sessionId}` },
        () => { for (const cb of callbacks) cb() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'audit_entries', filter: `session_id=eq.${sessionId}` },
        () => { for (const cb of callbacks) cb() },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'audit_class_states', filter: `session_id=eq.${sessionId}` },
        () => { for (const cb of callbacks) cb() },
      )
      .subscribe()
    entry = { channel, callbacks }
    channels.set(sessionId, entry)
  }
  entry.callbacks.add(onChange)

  return () => {
    const e = channels.get(sessionId)
    if (!e) return
    e.callbacks.delete(onChange)
    if (e.callbacks.size === 0) {
      supabase.removeChannel(e.channel)
      channels.delete(sessionId)
    }
  }
}
