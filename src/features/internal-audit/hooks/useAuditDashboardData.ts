import { useCallback, useEffect, useMemo, useState } from 'react'
import { auditApi } from '../api/auditApi'
import { useAuditRealtime } from './useAuditRealtime'
import { computeMetrics, groupByClass, type AuditMetrics, type AuditClassRow } from '../domain/auditSummary'
import type { AuditLiveBoardRow, AuditAlert } from '../api/auditTypes'

interface UseAuditDashboardDataResult {
  rows: AuditLiveBoardRow[]
  alerts: AuditAlert[]
  metrics: AuditMetrics
  classRows: AuditClassRow[]
  isLoading: boolean
  reload: () => Promise<void>
}

/**
 * Bundles live-board rows + alerts + derived metrics into one hook.
 * Refetches whenever Realtime fires.
 */
export function useAuditDashboardData(sessionId: string | null): UseAuditDashboardDataResult {
  const [rows, setRows] = useState<AuditLiveBoardRow[]>([])
  const [alerts, setAlerts] = useState<AuditAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!sessionId) {
      setRows([]); setAlerts([]); setIsLoading(false)
      return
    }
    try {
      const [b, a] = await Promise.all([
        auditApi.getLiveBoard(sessionId),
        auditApi.getAlerts(sessionId),
      ])
      setRows(b)
      setAlerts(a)
    } finally {
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => { setIsLoading(true); reload() }, [reload])

  useAuditRealtime({ sessionId, onAnyChange: reload })

  const metrics = useMemo(() => computeMetrics(rows), [rows])
  const classRows = useMemo(() => groupByClass(rows), [rows])

  return { rows, alerts, metrics, classRows, isLoading, reload }
}
