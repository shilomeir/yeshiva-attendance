import { CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'
import { useToast } from '@/hooks/use-toast'

function ToastIcon({ variant }: { variant?: string }) {
  if (variant === 'success') {
    return <CheckCircle2 className="h-5 w-5 text-[var(--green)] shrink-0 mt-0.5" />
  }
  if (variant === 'destructive') {
    return <AlertTriangle className="h-5 w-5 text-[var(--red)] shrink-0 mt-0.5" />
  }
  return <Info className="h-5 w-5 text-[var(--blue)] shrink-0 mt-0.5" />
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <ToastIcon variant={props.variant ?? undefined} />
            <div className="grid gap-0.5 flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
