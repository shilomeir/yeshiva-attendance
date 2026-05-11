import { useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { ListDeparturesOptions } from '@/lib/api/types'

type DeparturePayload = Record<string, unknown>

interface UseDeparturesRealtimeOptions extends ListDeparturesOptions {
  /** Called whenever an INSERT or UPDATE arrives on the departures table. */
  onInsert?: (row: DeparturePayload) => void
  onUpdate?: (row: DeparturePayload) => void
  onDelete?: (row: DeparturePayload) => void
  /** Generic callback — called for any change. Simplest way to trigger a refetch. */
  onAnyChange?: () => void
}

/**
 * Single shared hook for Supabase Realtime on the `departures` table.
 * Every dashboard, calendar, and student view subscribes through here
 * instead of maintaining their own channels.
 *
 * Applies a Postgres filter when studentId or classId is specified,
 * so each subscriber only receives changes relevant to their scope.
 *
 * Usage (simplest):
 *   useDeparturesRealtime({ onAnyChange: refetch })
 */
export function useDeparturesRealtime(options: UseDeparturesRealtimeOptions = {}) {
  const { studentId, classId, onInsert, onUpdate, onDelete, onAnyChange } = options

  // Stable refs so the subscription closure doesn't re-run on every render
  const onInsertRef = useRef(onInsert)
  const onUpdateRef = useRef(onUpdate)
  const onDeleteRef = useRef(onDelete)
  const onAnyChangeRef = useRef(onAnyChange)

  useEffect(() => {
    onInsertRef.current = onInsert
    onUpdateRef.current = onUpdate
    onDeleteRef.current = onDelete
    onAnyChangeRef.current = onAnyChange
  })

  // Build the Postgres filter string from options
  const filter = useMemo<string | undefined>(() => {
    if (studentId) return `student_id=eq.${studentId}`
    if (classId)   return `class_id=eq.${classId}`
    return undefined  // Admin: no filter = all departures
  }, [studentId, classId])

  // Channel name includes the filter so different scopes get separate channels
  const channelName = filter ? `departures-${filter}` : 'departures-all'

  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'departures', filter },
        (payload) => {
          onInsertRef.current?.(payload.new as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'departures', filter },
        (payload) => {
          onUpdateRef.current?.(payload.new as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'departures', filter },
        (payload) => {
          onDeleteRef.current?.(payload.old as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [channelName, filter])
}
