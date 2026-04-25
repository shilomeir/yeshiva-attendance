import { useState, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Shield, Loader2 } from 'lucide-react'
import { AdminLoginModal } from '@/components/auth/AdminLoginModal'
import { useAuthStore } from '@/store/authStore'

const SAVED_ID_KEY = 'yeshiva_last_id'

export function LoginScreen() {
  const navigate = useNavigate()
  const [idNumber, setIdNumber] = useState(() => localStorage.getItem(SAVED_ID_KEY) ?? '')
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [autoLogging, setAutoLogging] = useState(false)
  const { login, isLoading, error, clearError, currentUser, isAdmin } = useAuthStore()

  useEffect(() => {
    const rememberedId = localStorage.getItem('yeshiva_remembered_id')
    if (rememberedId) {
      setAutoLogging(true)
      login(rememberedId).then((success) => {
        if (success) {
          navigate('/student', { replace: true })
        } else {
          localStorage.removeItem('yeshiva_remembered_id')
          setAutoLogging(false)
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (currentUser) return <Navigate to="/student" replace />
  if (isAdmin) return <Navigate to="/admin" replace />

  if (autoLogging) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-4">
          <img src="/logo.png" alt="לוגו" className="h-20 w-auto animate-pulse" draggable={false} />
          <p className="text-sm text-[var(--text-muted)]">מתחבר...</p>
        </div>
      </div>
    )
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!idNumber.trim()) return
    const success = await login(idNumber.trim())
    if (success) {
      sessionStorage.setItem('show_remember_me', '1')
      sessionStorage.setItem('last_login_id', idNumber.trim())
      navigate('/student', { replace: true })
    }
  }

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIdNumber(e.target.value)
    if (error) clearError()
  }

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden"
      style={{ background: 'linear-gradient(155deg, #0f1f5c 0%, #1a3a8f 38%, #0e2d6e 65%, #0a1840 100%)' }}
    >
      {/* Building photo — shows automatically once yeshiva-building.jpg is in /public */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: 'url(/yeshiva-building.jpg)', opacity: 0.45 }}
      />
      {/* Depth overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, rgba(6,14,42,0.55) 0%, rgba(6,14,42,0.25) 50%, rgba(6,14,42,0.62) 100%)',
        }}
      />

      {/* Logo above card */}
      <div className="animate-slide-up relative z-10 mb-8 flex flex-col items-center gap-3">
        <img src="/logo.png" alt="ישיבת שבי חברון" className="h-28 w-auto drop-shadow-xl" draggable={false} />
        <p className="text-sm font-medium text-white/75 tracking-wide">מערכת נוכחות</p>
      </div>

      {/* Login card */}
      <div
        className="animate-slide-up delay-100 relative z-10 w-full max-w-sm overflow-hidden rounded-2xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Blue accent top strip */}
        <div
          className="h-1 w-full"
          style={{ background: 'linear-gradient(90deg, var(--blue), var(--purple))' }}
        />

        <div className="px-7 py-8">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-[var(--text)]">כניסה למערכת</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">הזן את מספר תעודת הזהות שלך</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <input
                id="idNumber"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={9}
                placeholder="123456789"
                value={idNumber}
                onChange={handleIdChange}
                autoComplete="off"
                autoFocus
                className="w-full rounded-xl px-4 py-3 text-center text-xl font-bold tracking-[0.2em] outline-none transition-all"
                style={{
                  background: 'var(--bg)',
                  border: error
                    ? '1.5px solid var(--red)'
                    : '1.5px solid var(--border)',
                  color: 'var(--text)',
                  boxShadow: error ? '0 0 0 3px rgba(239,68,68,0.1)' : 'none',
                }}
                onFocus={(e) => {
                  if (!error) {
                    e.currentTarget.style.border = '1.5px solid var(--blue)'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'
                  }
                }}
                onBlur={(e) => {
                  if (!error) {
                    e.currentTarget.style.border = '1.5px solid var(--border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }
                }}
              />
              {error && (
                <p className="text-sm text-[var(--red)] text-center" role="alert">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || idNumber.length < 5}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, var(--blue) 0%, var(--blue-dark) 100%)',
                boxShadow: isLoading || idNumber.length < 5
                  ? 'none'
                  : '0 4px 16px rgba(59,130,246,0.35)',
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מתחבר...
                </>
              ) : (
                'כניסה'
              )}
            </button>
          </form>

          {/* Admin link */}
          <div
            className="mt-6 border-t pt-5 text-center"
            style={{ borderColor: 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => setShowAdminModal(true)}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors"
            >
              <Shield className="h-3.5 w-3.5" />
              כניסת מנהל / רכז
            </button>
          </div>
        </div>
      </div>

      <AdminLoginModal open={showAdminModal} onClose={() => setShowAdminModal(false)} />
    </div>
  )
}
