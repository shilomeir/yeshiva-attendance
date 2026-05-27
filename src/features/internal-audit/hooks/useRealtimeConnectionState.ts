import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Tracks the live Supabase Realtime connection state for the audit dashboard.
 * Returns one of:
 *   'connecting' — initial / transient
 *   'connected'  — at least one channel currently OPEN
 *   'degraded'   — channels closed / channel error
 *
 * Mirrors the spec §10.4 Realtime indicator requirement (green / yellow / red).
 */
export type RealtimeConnectionState = 'connecting' | 'connected' | 'degraded'

export function useRealtimeConnectionState(): RealtimeConnectionState {
  const [state, setState] = useState<RealtimeConnectionState>('connecting')

  useEffect(() => {
    const check = () => {
      const channels = supabase.getChannels?.() ?? []
      if (channels.length === 0) {
        setState('connecting')
        return
      }
      const anyJoined = channels.some((c) => c.state === 'joined')
      const anyErrored = channels.some((c) => c.state === 'errored' || c.state === 'closed')
      if (anyJoined) setState('connected')
      else if (anyErrored) setState('degraded')
      else setState('connecting')
    }
    check()
    const id = setInterval(check, 3000)
    return () => clearInterval(id)
  }, [])

  return state
}
