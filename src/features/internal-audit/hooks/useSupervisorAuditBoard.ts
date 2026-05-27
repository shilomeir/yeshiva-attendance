import { useCallback, useEffect, useState } from 'react'
import { auditApi } from '../api/auditApi'
import { useAuditRealtime } from './useAuditRealtime'
import type { AuditClassBoardRow } from '../api/auditTypes'

interface UseSupervisorAuditBoardResult {
  rows: AuditClassBoardRow[]
  isLoading: boolean
  reload: () => Promise<void>
}

/**
 * Supervisor view of the audit — uses v_audit_class_board which strips lat/lng.
 */
export function useSupervisorAuditBoard(
  sessionId: string | null,
  classId: string | null,
): UseSupervisorAuditBoardResult {
  const [rows, setRows] = useState<AuditClassBoardRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!sessionId || !classId) {
      setRows([]); setIsLoading(false); return
    }
    try {
      const data = await auditApi.getClassBoard(sessionId, classId)
      setRows(data)
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, classId])

  useEffect(() => { setIsLoading(true); reload() }, [reload])

  useAuditRealtime({ sessionId, onAnyChange: reload })

  return { rows, isLoading, reload }
}
