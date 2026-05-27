import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { auditApi } from '../api/auditApi'
import type { AuditSession } from '../api/auditTypes'

interface UseActiveAuditSessionResult {
  session: AuditSession | null
  isLoading: boolean
  refresh: () => Promise<void>
}

/**
 * Single source of truth for "is there an audit session right now?"
 *
 * Strategy (matches spec §9.2 refresh principle):
 *   1. On mount, query DB.
 *   2. Subscribe to audit_sessions postgres_changes for live updates.
 *   3. On any event, refetch the active session via RPC.
 *
 * This way refresh always restores correct state — Realtime is just for UI sync.
 */
export function useActiveAuditSession(): UseActiveAuditSessionResult {
  const [session, setSession] = useState<AuditSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await auditApi.getActiveSession()
      setSession(data)
    } catch {
      setSession(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const channel = supabase
      .channel('audit_sessions-active')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_sessions' }, () => {
        refresh()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refresh])

  return { session, isLoading, refresh }
}
