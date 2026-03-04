import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[var(--blue)] text-white hover:bg-blue-600',
        secondary:
          'border-transparent bg-[var(--bg-2)] text-[var(--text)] hover:bg-[var(--border)]',
        destructive: 'border-transparent bg-[var(--red)] text-white hover:bg-red-600',
        outline: 'text-[var(--text)]',
        success: 'border-transparent bg-[var(--green)] text-white',
        warning: 'border-transparent bg-[var(--orange)] text-white',
        danger: 'border-transparent bg-[var(--red)] text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
