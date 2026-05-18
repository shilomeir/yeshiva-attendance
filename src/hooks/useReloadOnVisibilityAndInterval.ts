import { useEffect, useRef } from 'react'

/**
 * Belt-and-braces refresh helper for pages that mirror server state via
 * Supabase Realtime: in addition to whatever realtime subscription the page
 * already has, runs `refresh()` whenever the tab returns to the foreground
 * and every `intervalMs` while it is visible.
 *
 * Realtime alone is unreliable on flaky 3G or after a long iOS background
 * suspend — the WebSocket reconnect can take seconds and individual events
 * can be missed without the client noticing. Polling at a 30 s cadence
 * caps the staleness at a known bound; the visibility hook makes return-
 * to-foreground feel instant. Both are cheap (one RPC each) compared to
 * the cost of a supervisor staring at stale counts.
 *
 * Skip the polling tick while `document.hidden` so backgrounded tabs
 * don't keep churning the Supabase REST endpoint.
 */
export function useReloadOnVisibilityAndInterval(refresh: () => void, intervalMs: number) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) refreshRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const id = setInterval(() => {
      if (!document.hidden) refreshRef.current()
    }, intervalMs)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(id)
    }
  }, [intervalMs])
}
