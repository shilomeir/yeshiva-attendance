import type { StudentStatus } from '@/types'
import { cn } from '@/lib/utils/cn'

interface StatusBadgeProps {
  status: StudentStatus
  className?: string
  showDot?: boolean
}

const STATUS_CONFIG: Record<StudentStatus, { label: string; color: string; soft: string }> = {
  ON_CAMPUS:  { label: 'בישיבה',        color: 'var(--good)',     soft: 'var(--good-soft)' },
  OFF_CAMPUS: { label: 'מחוץ לישיבה',   color: 'var(--warn)',     soft: 'var(--warn-soft)' },
  OVERDUE:    { label: 'מחוץ לישיבה',   color: 'var(--warn)',     soft: 'var(--warn-soft)' },
  PENDING:    { label: 'ממתין',          color: 'var(--info)',     soft: 'var(--info-soft)' },
}

export function StatusBadge({ status, className, showDot = true }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
      style={{ background: cfg.soft, color: cfg.color, border: `1px solid ${cfg.color}33` }}
    >
      {showDot && (
        <span
          className="pulse-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: cfg.color }}
        />
      )}
      {cfg.label}
    </span>
  )
}
