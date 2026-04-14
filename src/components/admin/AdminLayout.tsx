import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Calendar,
  FileText,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  MapPin,
  ClipboardList,
  AlertOctagon,
} from 'lucide-react'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { SyncStatusBar } from '@/components/shared/SyncStatusBar'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'לוח בקרה', end: true },
  { to: '/admin/students', icon: Users, label: 'תלמידים' },
  { to: '/admin/rollcall', icon: MapPin, label: 'ביקורת פנימית' },
  { to: '/admin/calendar', icon: Calendar, label: 'לוח שנה' },
  { to: '/admin/exceptions', icon: AlertOctagon, label: 'חריגות עכשיו' },
  { to: '/admin/requests', icon: ClipboardList, label: 'בקשות ממתינות' },
  { to: '/admin/audit', icon: FileText, label: 'לוג ביקורת' },
  { to: '/admin/sms', icon: MessageSquare, label: 'SMS' },
  { to: '/admin/settings', icon: Settings, label: 'הגדרות' },
]

export function AdminLayout() {
  const { logout } = useAuthStore()
  const { sidebarOpen, setSidebarOpen } = useUiStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)]">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-64 flex-col bg-[var(--surface)] transition-transform duration-300 lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        )}
        style={{ borderInlineEnd: '1px solid var(--border)' }}
      >
        {/* Blue accent top strip */}
        <div
          className="h-1 w-full shrink-0"
          style={{ background: 'linear-gradient(90deg, var(--blue), var(--purple))' }}
        />

        {/* Logo area */}
        <div
          className="flex items-center justify-between px-4 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="לוגו" className="h-10 w-auto" draggable={false} />
            <div>
              <h1 className="text-sm font-bold text-[var(--text)] leading-tight">ישיבת שבי חברון</h1>
              <p className="text-[11px] text-[var(--text-muted)]">פאנל ניהול</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                      isActive
                        ? 'bg-[var(--blue)] text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)]'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : '')} />
                      {label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout */}
        <div className="p-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-red-50 hover:text-[var(--red)] dark:hover:bg-red-950/20 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            התנתקות
          </button>
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 py-3 bg-[var(--surface)]"
          style={{
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 1px 6px rgba(14, 30, 70, 0.05)',
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden rounded-xl p-2 text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)] transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block">
            <SyncStatusBar />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="hidden lg:flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--red)] transition-colors"
            >
              <LogOut className="h-4 w-4" />
              יציאה
            </button>
          </div>
        </header>

        <div className="lg:hidden">
          <SyncStatusBar />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
