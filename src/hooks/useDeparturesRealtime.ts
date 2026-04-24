import { useEffect, useRef } from 'react'
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
 * Usage (simplest):
 *   useDeparturesRealtime({ onAnyChange: refetch })
 */
export function useDeparturesRealtime(options: UseDeparturesRealtimeOptions = {}) {
  const { onInsert, onUpdate, onDelete, onAnyChange } = options

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

  useEffect(() => {
    const channel = supabase
      .channel('departures-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'departures' },
        (payload) => {
          onInsertRef.current?.(payload.new as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'departures' },
        (payload) => {
          onUpdateRef.current?.(payload.new as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'departures' },
        (payload) => {
          onDeleteRef.current?.(payload.old as DeparturePayload)
          onAnyChangeRef.current?.()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, []) // intentionally empty — options are accessed via refs
}
