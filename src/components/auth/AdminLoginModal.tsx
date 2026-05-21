import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Shield, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/authStore'

interface AdminLoginModalProps {
  open: boolean
  onClose: () => void
}

export function AdminLoginModal({ open, onClose }: AdminLoginModalProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { loginAdmin, loginClassSupervisor } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Master plan B-29: bounce back to the URL the guard kicked us out of, if any.
  const fromUrl = typeof location.state === 'object' && location.state && 'from' in location.state
    ? String((location.state as { from: unknown }).from)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) return

    // Master plan B-18: _resolve_supervisor_class silently returns NULL for
    // PINs shorter than 4 chars, which would surface as a confusing AUTH
    // error for a 3-digit typo. Validate length up front so the user gets a
    // clear message instead.
    if (pin.length < 4) {
      setError('הזן לפחות 4 ספרות')
      return
    }

    setIsLoading(true)
    setError('')

    await new Promise((resolve) => setTimeout(resolve, 400))

    // 1. Try admin PIN first (exact match)
    const adminOk = await loginAdmin(pin)
    if (adminOk) {
      onClose()
      navigate(fromUrl && fromUrl.startsWith('/admin') ? fromUrl : '/admin')
      setIsLoading(false)
      return
    }

    // 2. Try class-supervisor PIN (admin PIN + grade letter + class number)
    const supervisorOk = await loginClassSupervisor(pin)
    if (supervisorOk) {
      onClose()
      navigate(fromUrl && fromUrl.startsWith('/class-supervisor') ? fromUrl : '/class-supervisor')
      setIsLoading(false)
      return
    }

    setError('קוד גישה שגוי')
    setPin('')
    setIsLoading(false)
  }

  const handleClose = () => {
    setPin('')
    setError('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[var(--blue)]" />
            <DialogTitle>כניסת מנהל / אחראי כיתה</DialogTitle>
          </div>
          <DialogDescription>הזן את קוד הגישה להמשך</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input type="text" autoComplete="username" className="hidden" readOnly value="admin" />
          <div className="flex flex-col gap-2">
            <Label htmlFor="pin">קוד גישה</Label>
            <Input
              id="pin"
              type="password"
              inputMode="text"
              placeholder="••••"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value)
                setError('')
              }}
              className="text-center text-2xl tracking-widest"
              autoComplete="current-password"
              autoFocus
            />
            {error && (
              <p className="text-sm text-[var(--red)]" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
              ביטול
            </Button>
            <Button type="submit" className="flex-1" disabled={isLoading || !pin}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מתחבר...
                </>
              ) : (
                'כניסה'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
