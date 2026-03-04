import { Badge } from '@/components/ui/badge'
import type { StudentStatus } from '@/types'

interface StatusBadgeProps {
  status: StudentStatus
  className?: string
}

const STATUS_CONFIG: Record<StudentStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  ON_CAMPUS: { label: 'בישיבה', variant: 'success' },
  OFF_CAMPUS: { label: 'מחוץ לישיבה', variant: 'warning' },
  OVERDUE: { label: 'באיחור', variant: 'danger' },
  PENDING: { label: 'ממתין', variant: 'secondary' },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  )
}
