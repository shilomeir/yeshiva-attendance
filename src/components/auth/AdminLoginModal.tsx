import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const { loginAdmin } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) return

    setIsLoading(true)
    setError('')

    // Simulate small delay
    await new Promise((resolve) => setTimeout(resolve, 500))

    const success = loginAdmin(pin)
    setIsLoading(false)

    if (success) {
      onClose()
      navigate('/admin')
    } else {
      setError('קוד גישה שגוי')
      setPin('')
    }
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
            <DialogTitle>כניסת מנהל</DialogTitle>
          </div>
          <DialogDescription>הזן את קוד הגישה של המנהל להמשך</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pin">קוד גישה</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
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
