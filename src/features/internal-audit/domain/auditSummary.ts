import type { AuditLiveBoardRow } from '../api/auditTypes'
import { deriveFromRow, getMetricBucket, type AuditMetricBucket } from './auditStatus'

export interface AuditMetrics {
  total: number
  onCampus: number
  approvedOutside: number
  exceptions: number
  needsSupervisor: number
  pending: number
  checked: number
  completionPct: number
}

const ZERO: Record<AuditMetricBucket, number> = {
  checked: 0,
  onCampus: 0,
  approvedOutside: 0,
  exceptions: 0,
  needsSupervisor: 0,
  pending: 0,
}

export function computeMetrics(rows: AuditLiveBoardRow[]): AuditMetrics {
  const counts = { ...ZERO }
  for (const row of rows) {
    const bucket = getMetricBucket(deriveFromRow(row))
    counts[bucket] += 1
  }
  const total = rows.length
  const checked = total - counts.pending
  return {
    total,
    onCampus: counts.onCampus,
    approvedOutside: counts.approvedOutside,
    exceptions: counts.exceptions,
    needsSupervisor: counts.needsSupervisor,
    pending: counts.pending,
    checked,
    completionPct: total > 0 ? Math.round((checked / total) * 100) : 0,
  }
}

export interface AuditClassRow {
  classId: string
  grade: string
  total: number
  checked: number
  onCampus: number
  approvedOutside: number
  exceptions: number
  needsSupervisor: number
  pending: number
  completionPct: number
}

export function groupByClass(rows: AuditLiveBoardRow[]): AuditClassRow[] {
  const map = new Map<string, AuditClassRow>()
  for (const row of rows) {
    const key = row.class_id
    let entry = map.get(key)
    if (!entry) {
      entry = {
        classId: row.class_id,
        grade: row.grade,
        total: 0, checked: 0,
        onCampus: 0, approvedOutside: 0,
        exceptions: 0, needsSupervisor: 0, pending: 0,
        completionPct: 0,
      }
      map.set(key, entry)
    }
    entry.total += 1
    const bucket = getMetricBucket(deriveFromRow(row))
    switch (bucket) {
      case 'onCampus':         entry.onCampus += 1; entry.checked += 1; break
      case 'approvedOutside':  entry.approvedOutside += 1; entry.checked += 1; break
      case 'exceptions':       entry.exceptions += 1; entry.checked += 1; break
      case 'needsSupervisor':  entry.needsSupervisor += 1; break
      case 'pending':          entry.pending += 1; break
      case 'checked':          entry.checked += 1; break
    }
  }
  const out = [...map.values()]
  for (const c of out) {
    c.completionPct = c.total > 0 ? Math.round((c.checked / c.total) * 100) : 0
  }
  out.sort((a, b) => a.classId.localeCompare(b.classId, 'he'))
  return out
}
