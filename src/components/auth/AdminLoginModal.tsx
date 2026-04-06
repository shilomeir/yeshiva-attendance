import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Loader2, GraduationCap } from 'lucide-react'
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) return

    setIsLoading(true)
    setError('')

    await new Promise((resolve) => setTimeout(resolve, 400))

    // 1. Try admin PIN first (exact match)
    const adminOk = await loginAdmin(pin)
    if (adminOk) {
      onClose()
      navigate('/admin')
      setIsLoading(false)
      return
    }

    // 2. Try class-supervisor PIN (admin PIN + grade letter + class number)
    const supervisorOk = await loginClassSupervisor(pin)
    if (supervisorOk) {
      onClose()
      navigate('/class-supervisor')
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
              autoFocus
            />
            {error && (
              <p className="text-sm text-[var(--red)]" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Hint for supervisors */}
          <div className="flex items-start gap-2 rounded-lg bg-[var(--bg-2)] px-3 py-2.5">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <p className="text-xs text-[var(--text-muted)]">
              אחראי כיתה: הזן את קוד הגישה הכולל + אות השכבה + מספר הכיתה
              <br />
              <span className="opacity-60">לדוגמה: כיתה 3 בשיעור א' — קוד + a3</span>
            </p>
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
