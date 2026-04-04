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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-[var(--border)] bg-[var(--surface)] transition-transform duration-300 lg:relative lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        )}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="לוגו" className="h-10 w-auto" draggable={false} />
            <div>
              <h1 className="font-bold text-[var(--text)]">ישיבת שבי חברון</h1>
              <p className="text-xs text-[var(--text-muted)]">פאנל ניהול</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-[var(--blue)] text-white'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)]'
                    )
                  }
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout */}
        <div className="border-t border-[var(--border)] p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-2)] hover:text-[var(--red)] transition-colors"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            התנתקות
          </button>
        </div>
      </aside>

      {/* Backdrop for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="hidden lg:block">
            <SyncStatusBar />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleLogout} className="hidden lg:flex gap-1.5">
              <LogOut className="h-4 w-4" />
              יציאה
            </Button>
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
