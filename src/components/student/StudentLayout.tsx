import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, FileText, History, LogOut } from 'lucide-react'
import { SyncStatusBar } from '@/components/shared/SyncStatusBar'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { RememberMeBanner } from '@/components/auth/RememberMeBanner'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { subscribeToPush } from '@/lib/pwa/webPush'
import { cn } from '@/lib/utils/cn'

const SAVED_ID_KEY = 'yeshiva_last_id'

const NAV_ITEMS = [
  { to: '/student', icon: Home, label: 'בית', end: true },
  { to: '/student/requests', icon: FileText, label: 'בקשות' },
  { to: '/student/history', icon: History, label: 'היסטוריה' },
]

export function StudentLayout() {
  const { currentUser, logout } = useAuthStore()
  const navigate = useNavigate()

  // Show "Remember me" banner once right after login (flag set by LoginScreen)
  const [showRememberBanner] = useState(() => {
    const flag = sessionStorage.getItem('show_remember_me')
    if (flag) {
      sessionStorage.removeItem('show_remember_me')
      return true
    }
    return false
  })
  const [bannerVisible, setBannerVisible] = useState(showRememberBanner)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleRememberYes = async () => {
    if (!currentUser) return
    const subscription = await subscribeToPush()
    if (subscription) {
      await api.updatePushToken(currentUser.id, JSON.stringify(subscription))
    }
    // Save ID for next auto-fill
    const lastId = sessionStorage.getItem('last_login_id')
    if (lastId) {
      localStorage.setItem(SAVED_ID_KEY, lastId)
      sessionStorage.removeItem('last_login_id')
    }
    setBannerVisible(false)
  }

  const handleRememberNo = () => {
    sessionStorage.removeItem('last_login_id')
    setBannerVisible(false)
  }

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)]">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]">
        <SyncStatusBar />
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="לוגו" className="h-9 w-auto" draggable={false} />
            <div>
              <h1 className="text-base font-semibold text-[var(--text)]">
                {currentUser?.fullName ?? 'תלמיד'}
              </h1>
              <p className="text-xs text-[var(--text-muted)]">ישיבת שבי חברון</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center justify-center rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--red)] transition-colors"
              aria-label="התנתקות"
              title="התנתקות"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] safe-area-pb">
        <div className="grid grid-cols-3 h-16">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-[var(--blue)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'h-5 w-5 transition-transform',
                      isActive && 'scale-110'
                    )}
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* "Remember me" banner — shown once right after login */}
      {bannerVisible && (
        <RememberMeBanner onYes={handleRememberYes} onNo={handleRememberNo} />
      )}
    </div>
  )
}
