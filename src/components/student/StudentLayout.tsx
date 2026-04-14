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
    const lastId = sessionStorage.getItem('last_login_id')
    if (lastId) {
      localStorage.setItem(SAVED_ID_KEY, lastId)
      localStorage.setItem('yeshiva_remembered_id', lastId)
      sessionStorage.removeItem('last_login_id')
    }
    setBannerVisible(false)
  }

  const handleRememberNo = () => {
    sessionStorage.removeItem('last_login_id')
    setBannerVisible(false)
  }

  // Initials avatar color based on name
  const getAvatarColor = (name: string) => {
    const colors = [
      ['#1E3A6E', '#60A5FA'],
      ['#1A3A2A', '#34D399'],
      ['#3A1A2A', '#F472B6'],
      ['#2A1A3A', '#A78BFA'],
      ['#3A2A1A', '#FBBF24'],
    ]
    const idx = name.charCodeAt(0) % colors.length
    return colors[idx]
  }

  const initials = currentUser?.fullName
    ? currentUser.fullName.split(' ').map((w) => w[0]).slice(0, 2).join('')
    : '?'

  const avatarColors = getAvatarColor(currentUser?.fullName ?? '')

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)]">
      {/* Top header */}
      <header
        className="sticky top-0 z-40"
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          boxShadow: '0 1px 8px rgba(14, 30, 70, 0.06)',
        }}
      >
        <SyncStatusBar />
        <div className="flex items-center justify-between px-4 py-3">
          {/* Student identity */}
          <div className="flex items-center gap-3">
            {/* Avatar circle with initials */}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{
                background: `linear-gradient(135deg, ${avatarColors[0]}, ${avatarColors[0]}DD)`,
                color: avatarColors[1],
                border: `1.5px solid ${avatarColors[1]}40`,
              }}
            >
              {initials}
            </div>
            <div>
              <h1 className="text-sm font-bold text-[var(--text)] leading-tight">
                {currentUser?.fullName ?? 'תלמיד'}
              </h1>
              <p className="text-[11px] text-[var(--text-muted)]">ישיבת שבי חברון</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center justify-center rounded-xl p-2 text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--red)] transition-colors"
              aria-label="התנתקות"
              title="התנתקות"
            >
              <LogOut className="h-4.5 w-4.5" style={{ height: '1.125rem', width: '1.125rem' }} />
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 safe-area-pb"
        style={{
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -4px 20px rgba(14, 30, 70, 0.08)',
        }}
      >
        <div className="grid grid-cols-3 h-16">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="relative flex flex-col items-center justify-center gap-1"
            >
              {({ isActive }) => (
                <>
                  {/* Active indicator bar at top */}
                  <span
                    className="absolute top-0 inset-x-4 h-0.5 rounded-full transition-all duration-300"
                    style={{
                      background: isActive ? 'var(--blue)' : 'transparent',
                      boxShadow: isActive ? '0 0 8px rgba(59,130,246,0.5)' : 'none',
                    }}
                  />

                  {/* Icon */}
                  <div
                    className={cn(
                      'flex items-center justify-center rounded-xl p-1.5 transition-all duration-200',
                      isActive ? 'scale-110' : 'scale-100'
                    )}
                    style={{
                      background: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
                    }}
                  >
                    <Icon
                      className="h-5 w-5 transition-colors"
                      style={{ color: isActive ? 'var(--blue)' : 'var(--text-muted)' }}
                    />
                  </div>

                  {/* Label */}
                  <span
                    className="text-[11px] font-semibold transition-colors"
                    style={{ color: isActive ? 'var(--blue)' : 'var(--text-muted)' }}
                  >
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* "Remember me" banner */}
      {bannerVisible && (
        <RememberMeBanner onYes={handleRememberYes} onNo={handleRememberNo} />
      )}
    </div>
  )
}
