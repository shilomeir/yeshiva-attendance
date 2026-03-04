import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Shield, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminLoginModal } from '@/components/auth/AdminLoginModal'
import { useAuthStore } from '@/store/authStore'

export function LoginScreen() {
  const [idNumber, setIdNumber] = useState('')
  const [showAdminModal, setShowAdminModal] = useState(false)
  const { login, isLoading, error, clearError, currentUser, isAdmin } = useAuthStore()

  if (currentUser) return <Navigate to="/student" replace />
  if (isAdmin) return <Navigate to="/admin" replace />

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!idNumber.trim()) return
    await login(idNumber.trim())
  }

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIdNumber(e.target.value)
    if (error) clearError()
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4">
      {/* Header */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <img src="/logo.png" alt="ישיבת שבי חברון" className="h-28 w-auto" draggable={false} />
        <p className="text-sm text-[var(--text-muted)]">מערכת נוכחות</p>
      </div>

      {/* Login Card */}
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">כניסה למערכת</CardTitle>
          <CardDescription>הזן את מספר תעודת הזהות שלך להתחברות</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="idNumber">מספר תעודת זהות</Label>
              <Input
                id="idNumber"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={9}
                placeholder="123456789"
                value={idNumber}
                onChange={handleIdChange}
                className="text-center text-lg tracking-widest"
                autoComplete="off"
                autoFocus
              />
              {error && (
                <p className="text-sm text-[var(--red)]" role="alert">
                  {error}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || idNumber.length < 5}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מתחבר...
                </>
              ) : (
                'כניסה'
              )}
            </Button>
          </form>

          {/* Admin link */}
          <div className="mt-6 border-t border-[var(--border)] pt-4 text-center">
            <button
              type="button"
              onClick={() => setShowAdminModal(true)}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors"
            >
              <Shield className="h-3.5 w-3.5" />
              כניסת מנהל
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Admin modal */}
      <AdminLoginModal open={showAdminModal} onClose={() => setShowAdminModal(false)} />
    </div>
  )
}
