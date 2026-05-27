import { useEffect, useRef, useState } from 'react'
import { auditApi } from '../api/auditApi'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import type { AuditSession } from '../api/auditTypes'

export type AuditCollectorState =
  | { phase: 'idle' }
  | { phase: 'detecting' }
  | { phase: 'collecting' }
  | { phase: 'sent'; locationClass: string; distance: number | null }
  | { phase: 'denied' }
  | { phase: 'failed'; message: string }
  | { phase: 'approved_outside' }

interface UseStudentAuditCollectorOptions {
  studentId: string | undefined
  session: AuditSession | null
}

/**
 * Detects an active LOCATION-mode audit session and immediately collects GPS.
 * Runs once per (session, student) pair. Idempotent on the server side too —
 * the RPC does upsert, so accidental double-fire is harmless.
 */
export function useStudentAuditCollector({
  studentId,
  session,
}: UseStudentAuditCollectorOptions): AuditCollectorState {
  const [state, setState] = useState<AuditCollectorState>({ phase: 'idle' })
  const triggeredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!studentId || !session) {
      setState({ phase: 'idle' })
      triggeredRef.current = null
      return
    }
    if (session.status !== 'ACTIVE' || session.mode !== 'LOCATION') {
      setState({ phase: 'idle' })
      return
    }
    const key = `${session.id}:${studentId}`
    if (triggeredRef.current === key) return
    triggeredRef.current = key

    let cancelled = false

    async function run() {
      if (!session || !studentId) return
      setState({ phase: 'detecting' })
      try {
        await auditApi.recordAppOpened(session.id, studentId, {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        })
      } catch {
        // Non-fatal — continue to GPS collection
      }
      if (cancelled) return
      setState({ phase: 'collecting' })

      const gps = await getCurrentPosition()
      if (cancelled) return

      if (isGPSResult(gps)) {
        try {
          const result = await auditApi.recordLocationResponse({
            sessionId: session.id,
            studentId,
            lat: gps.lat,
            lng: gps.lng,
            accuracy: gps.accuracy,
            gpsStatus: 'GRANTED',
          })
          setState({
            phase: 'sent',
            locationClass: result.locationClass,
            distance: result.distance,
          })
        } catch (err) {
          setState({ phase: 'failed', message: err instanceof Error ? err.message : 'failed' })
        }
      } else if (gps.status === 'DENIED_BY_USER') {
        try {
          await auditApi.recordLocationResponse({
            sessionId: session.id,
            studentId,
            lat: null, lng: null, accuracy: null,
            gpsStatus: 'DENIED_BY_USER',
            errorMessage: gps.message,
          })
        } catch { /* surface UI state regardless */ }
        setState({ phase: 'denied' })
      } else {
        try {
          await auditApi.recordLocationResponse({
            sessionId: session.id,
            studentId,
            lat: null, lng: null, accuracy: null,
            gpsStatus: 'UNAVAILABLE',
            errorMessage: gps.message,
          })
        } catch { /* surface UI state regardless */ }
        setState({ phase: 'failed', message: gps.message })
      }
    }

    run()
    return () => { cancelled = true }
  }, [session?.id, session?.status, session?.mode, studentId])

  return state
}
