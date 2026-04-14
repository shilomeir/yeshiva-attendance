import type { StudentStatus } from '@/types'
import { cn } from '@/lib/utils/cn'

interface StatusBadgeProps {
  status: StudentStatus
  className?: string
  showDot?: boolean
}

const STATUS_CONFIG: Record<
  StudentStatus,
  { label: string; dotColor: string; bg: string; text: string; border: string }
> = {
  ON_CAMPUS: {
    label: 'בישיבה',
    dotColor: '#22C55E',
    bg: 'rgba(34,197,94,0.1)',
    text: '#16A34A',
    border: 'rgba(34,197,94,0.25)',
  },
  OFF_CAMPUS: {
    label: 'מחוץ לישיבה',
    dotColor: '#F97316',
    bg: 'rgba(249,115,22,0.1)',
    text: '#EA580C',
    border: 'rgba(249,115,22,0.25)',
  },
  OVERDUE: {
    label: 'מחוץ לישיבה',
    dotColor: '#F97316',
    bg: 'rgba(249,115,22,0.1)',
    text: '#EA580C',
    border: 'rgba(249,115,22,0.25)',
  },
  PENDING: {
    label: 'ממתין',
    dotColor: '#94A3B8',
    bg: 'rgba(148,163,184,0.1)',
    text: '#64748B',
    border: 'rgba(148,163,184,0.25)',
  },
}

export function StatusBadge({ status, className, showDot = true }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', className)}
      style={{
        background: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {showDot && (
        <span
          className="pulse-dot inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: cfg.dotColor }}
        />
      )}
      {cfg.label}
    </span>
  )
}
