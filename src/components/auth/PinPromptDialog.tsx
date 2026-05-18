import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/lib/supabase'

export type PinRole = 'admin' | 'supervisor'

interface PinPromptContextValue {
  /**
   * Returns the cached PIN for the given role if one exists in the session.
   * Otherwise opens the prompt dialog, verifies the entered PIN against the
   * matching `verify_*_pin` RPC, caches it in `authStore`, and resolves with it.
   * Resolves with `null` if the user dismisses the dialog.
   */
  requestPin: (role: PinRole, reason?: string) => Promise<string | null>
  /**
   * Forcefully clears the cached PIN for the given role. Call this when an RPC
   * returns `{error:'AUTH'}` so the next `requestPin` re-prompts.
   */
  clearPin: (role: PinRole) => void
}

const PinPromptContext = createContext<PinPromptContextValue | null>(null)

type Pending = {
  role: PinRole
  reason: string | null
  resolve: (pin: string | null) => void
} | null

export function PinPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef<Pending>(null)

  const clearPin = useCallback((role: PinRole) => {
    if (role === 'admin') useAuthStore.setState({ _adminPinSession: null })
    else useAuthStore.setState({ _supervisorPinSession: null })
  }, [])

  const requestPin = useCallback((role: PinRole, reason?: string): Promise<string | null> => {
    const auth = useAuthStore.getState()
    const cached = role === 'admin' ? auth.getAdminPin() : auth.getSupervisorPin()
    if (cached) return Promise.resolve(cached)
    return new Promise<string | null>((resolve) => {
      const next: Pending = { role, reason: reason ?? null, resolve }
      pendingRef.current = next
      setPending(next)
      setPin('')
      setError(null)
    })
  }, [])

  const closeWith = useCallback((pinValue: string | null) => {
    pendingRef.current?.resolve(pinValue)
    pendingRef.current = null
    setPending(null)
    setPin('')
    setError(null)
    setSubmitting(false)
  }, [])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const current = pendingRef.current
    if (!current || submitting) return
    const trimmed = pin.trim()
    if (!trimmed) {
      setError('יש להזין PIN')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (current.role === 'admin') {
        const { data, error } = await supabase.rpc('verify_admin_pin', { p_pin: trimmed })
        if (error) {
          setError('שגיאה בבדיקת ה-PIN')
          setSubmitting(false)
          return
        }
        if (!data) {
          setError('PIN שגוי')
          setSubmitting(false)
          return
        }
        useAuthStore.setState({ _adminPinSession: trimmed })
      } else {
        const { data, error } = await supabase.rpc('verify_supervisor_pin', { p_pin: trimmed })
        if (error || !data || (data as { error?: string }).error) {
          setError('PIN שגוי')
          setSubmitting(false)
          return
        }
        useAuthStore.setState({ _supervisorPinSession: trimmed })
      }
      closeWith(trimmed)
    } catch {
      setError('שגיאה לא צפויה')
      setSubmitting(false)
    }
  }

  const roleLabel = pending?.role === 'admin' ? 'מנהל' : 'אחראי כיתה'

  return (
    <PinPromptContext.Provider value={{ requestPin, clearPin }}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) closeWith(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              נדרש PIN {roleLabel}
            </DialogTitle>
            <DialogDescription>
              {pending?.reason ?? `הזן את ה-PIN שלך כדי להמשיך בפעולת הביקורת.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              autoFocus
              placeholder="PIN"
              value={pin}
              onChange={(e) => { setPin(e.target.value); if (error) setError(null) }}
              disabled={submitting}
            />
            {error && <p className="text-sm text-[var(--red)]">{error}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => closeWith(null)} disabled={submitting}>
                ביטול
              </Button>
              <Button type="submit" disabled={submitting || pin.trim().length === 0}>
                {submitting ? 'מאמת...' : 'אישור'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PinPromptContext.Provider>
  )
}

export function usePinPrompt(): PinPromptContextValue {
  const ctx = useContext(PinPromptContext)
  if (!ctx) throw new Error('usePinPrompt must be used within <PinPromptProvider>')
  return ctx
}
