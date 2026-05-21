import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, FileText, History, LogOut } from 'lucide-react'
import { SyncStatusBar } from '@/components/shared/SyncStatusBar'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { RememberMeBanner } from '@/components/auth/RememberMeBanner'
import { StudentHelpSheet } from '@/components/student/StudentHelpSheet'
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
      // Don't re-prompt if push is already registered for this device
      return !currentUser?.push_token
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
    try {
      const subscription = await subscribeToPush()
      if (subscription) {
        await api.updatePushToken(currentUser.id, JSON.stringify(subscription))
      }
    } catch {
      // Push setup failed — still save the remembered ID below
    }
    const idToSave = sessionStorage.getItem('last_login_id') ?? currentUser.idNumber
    localStorage.setItem(SAVED_ID_KEY, idToSave)
    localStorage.setItem('yeshiva_remembered_id', idToSave)
    sessionStorage.removeItem('last_login_id')
    setBannerVisible(false)
  }

  const handleRememberNo = () => {
    sessionStorage.removeItem('last_login_id')
    setBannerVisible(false)
  }

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

  const firstName = currentUser?.fullName?.split(' ')[0] ?? 'תלמיד'
  const avatarColors = getAvatarColor(currentUser?.fullName ?? '')

  return (
    <div className="flex flex-col min-h-screen student-bg">
      {/* Glass top header */}
      <header className="sticky top-0 z-40 student-header">
        <SyncStatusBar />
        <div className="flex items-center justify-between px-4 py-3">
          {/* Student identity */}
          <div className="flex items-center gap-3">
            <div
              className="shrink-0 flex items-center justify-center text-sm font-bold"
              style={{
                width: 46,
                height: 46,
                borderRadius: 16,
                background: `linear-gradient(135deg, ${avatarColors[0]} 0%, ${avatarColors[0]}DD 100%)`,
                color: avatarColors[1],
                border: `1.5px solid ${avatarColors[1]}40`,
                boxShadow: `0 6px 14px ${avatarColors[0]}52`,
              }}
            >
              {initials}
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight" style={{ color: 'var(--text)' }}>
                שלום, {firstName}
              </h1>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>ישיבת שבי חברון</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <StudentHelpSheet />
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center justify-center rounded-xl p-2 transition-colors"
              style={{ color: 'var(--text-muted)' }}
              aria-label="התנתקות"
              title="התנתקות"
            >
              <LogOut style={{ height: '1.125rem', width: '1.125rem' }} />
            </button>
          </div>
        </div>
      </header>

      {/* Page content — extra bottom padding for floating tab bar */}
      <main className="flex-1 overflow-y-auto pb-28">
        <Outlet />
      </main>

      {/* Floating glass pill tab bar */}
      <nav className="student-tab-bar" dir="rtl">
        {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex flex-col items-center justify-center gap-1 flex-1"
          >
            {({ isActive }) => (
              <>
                <div
                  className={cn(
                    'flex items-center justify-center rounded-xl transition-all duration-200',
                    isActive ? 'scale-110' : 'scale-100'
                  )}
                  style={{
                    width: 44,
                    height: 32,
                    background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                  }}
                >
                  <Icon
                    className="h-5 w-5 transition-colors"
                    style={{ color: isActive ? '#4f46e5' : 'var(--text-muted)' }}
                  />
                </div>
                <span
                  className="text-[10px] font-bold transition-colors"
                  style={{ color: isActive ? '#4f46e5' : 'var(--text-muted)' }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {bannerVisible && (
        <RememberMeBanner onYes={handleRememberYes} onNo={handleRememberNo} />
      )}
    </div>
  )
}
