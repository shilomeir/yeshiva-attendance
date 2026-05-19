import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function getModalPortalTarget(ownerDocument: Pick<Document, 'body'> | null | undefined = typeof document === 'undefined' ? null : document) {
  return ownerDocument?.body ?? null
}

export function ModalPortal({ children }: { children: ReactNode }) {
  const target = getModalPortalTarget()

  if (!target) return <>{children}</>
  return createPortal(children, target)
}
