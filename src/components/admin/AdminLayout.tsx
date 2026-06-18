import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Calendar, FileText, Settings,
  LogOut, Menu, MapPin, ClipboardList, AlertOctagon,
  Search, Bell, Sparkles, RefreshCw,
} from 'lucide-react'
import { SyncStatusBar } from '@/components/shared/SyncStatusBar'
import { RememberMeBanner } from '@/components/auth/RememberMeBanner'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { to: '/admin',            icon: LayoutDashboard, label: 'לוח הבקרה',    desc: 'סקירה כללית',        end: true },
  { to: '/admin/students',   icon: Users,           label: 'תלמידים',       desc: 'ניהול תלמידים'       },
  { to: '/admin/rollcall',   icon: MapPin,          label: 'ביקורת פנימית', desc: 'מיקום בזמן אמת'     },
  { to: '/admin/calendar',   icon: Calendar,        label: 'לוח שנה',       desc: 'יציאות והיעדרויות' },
  { to: '/admin/exceptions', icon: AlertOctagon,    label: 'חריגות עכשיו',  desc: 'מחוץ לישיבה כרגע', urgent: true },
  { to: '/admin/requests',   icon: ClipboardList,   label: 'בקשות ממתינות', desc: 'אישור / דחייה'      },
  { to: '/admin/audit',      icon: FileText,        label: 'לוג ביקורת',    desc: 'היסטוריית פעולות'  },
  { to: '/admin/settings',   icon: Settings,        label: 'הגדרות',        desc: 'הגדרות מערכת'       },
]

export function AdminLayout() {
  const { logout, rememberSession } = useAuthStore()
  const { sidebarOpen, setSidebarOpen } = useUiStore()
  const navigate = useNavigate()
  const [time, setTime] = useState(new Date())
  const [bannerVisible, setBannerVisible] = useState(() => {
    if (sessionStorage.getItem('show_remember_me')) {
      sessionStorage.removeItem('show_remember_me')
      return true
    }
    return false
  })

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const timeStr = time.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const dateStr = time.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div
      className="relative flex h-screen overflow-hidden"
      style={{ background: 'var(--bg)', fontFamily: "'Heebo', system-ui, sans-serif" }}
    >
      {/* ── Animated mesh background ────────────────────────────────────── */}
      <div className="admin-mesh" aria-hidden>
        <span className="orb-3" />
        <span className="orb-4" />
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex flex-col lg:relative lg:translate-x-0 transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
        )}
        style={{ width: 280, flexShrink: 0, padding: '20px 16px 16px', gap: 4, display: 'flex', flexDirection: 'column' }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 8px 18px',
            borderBottom: '1px solid var(--hairline)', marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg, var(--ink), #3D3853 60%, var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontFamily: 'Fraunces, serif', fontWeight: 600,
              fontSize: 20, letterSpacing: '-0.04em',
              boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 12px -2px rgba(20,18,25,0.3)',
            }}
          >
            ש
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
              ישיבת שבי חברון
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>פאנל ניהול · v2.0</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}
          >
            ✕
          </button>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <style>{`
            .admin-nav-link {
              display: flex; align-items: center; gap: 12px;
              padding: 10px 12px; border-radius: 12px; cursor: pointer;
              transition: all 0.18s ease; position: relative;
              text-decoration: none; color: var(--ink);
            }
            .admin-nav-link:hover { background: rgba(255,255,255,0.55); }
            .admin-nav-link.active {
              background: var(--glass-3);
              border: 1px solid var(--hairline);
              box-shadow: 0 1px 0 rgba(255,255,255,0.6) inset, 0 4px 14px -4px rgba(20,18,25,0.08);
            }
            .admin-nav-icon {
              width: 32px; height: 32px; border-radius: 10px;
              display: flex; align-items: center; justify-content: center;
              background: rgba(20,18,25,0.04); color: var(--ink-muted);
              flex-shrink: 0; transition: all 0.18s;
            }
            .admin-nav-link.active .admin-nav-icon {
              background: var(--ink); color: white;
              transform: rotate(-3deg) scale(1.04);
            }
            .admin-nav-accent {
              position: absolute; inset-inline-start: -16px; top: 50%;
              transform: translateY(-50%); width: 3px; height: 18px;
              background: var(--accent); border-radius: 999px;
            }
          `}</style>
          {NAV_ITEMS.map(({ to, icon: Icon, label, desc, end, urgent }) => (
            <NavLink
              key={to} to={to} end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn('admin-nav-link', isActive && 'active')}
            >
              {({ isActive }) => (
                <>
                  <div className="admin-nav-icon">
                    <Icon size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 1 }}>{desc}</div>
                  </div>
                  {urgent && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--bad)', flexShrink: 0,
                      animation: 'admin-shimmer-pulse 1.4s ease-in-out infinite',
                    }} />
                  )}
                  {isActive && <span className="admin-nav-accent" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Profile */}
        <div
          className="glass"
          style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, borderRadius: 14, marginTop: 8 }}
        >
          <div
            style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--ink), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 13, fontWeight: 700,
            }}
          >
            מנ
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>ניהול</div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>ראש המנהלה</div>
          </div>
          <button
            onClick={handleLogout}
            title="התנתקות"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4, borderRadius: 8 }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(20,18,25,0.32)', backdropFilter: 'blur(8px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div
        className="admin-main-wrapper"
        style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          margin: '14px 0 14px 14px', borderRadius: 22,
          position: 'relative', zIndex: 1,
          background: 'rgba(255,255,255,0.55)',
          border: '1px solid var(--hairline)',
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
          boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}
      >
        {/* Top bar */}
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 24px 14px 18px',
            borderBottom: '1px solid var(--hairline)',
            background: 'rgba(255,255,255,0.45)',
            backdropFilter: 'blur(16px)',
            position: 'relative', zIndex: 3,
          }}
        >
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 8 }}
          >
            <Menu size={18} />
          </button>

          {/* Date + time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--ink-muted)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                className="font-mono-num"
                style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}
              >
                {timeStr}
              </span>
              <span className="hidden sm:inline" style={{ width: 1, height: 12, background: 'var(--hairline-2)', display: 'inline-block' }} />
              <span className="hidden sm:inline">{dateStr}</span>
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Sync status (hidden on mobile) */}
          <div className="hidden lg:block">
            <SyncStatusBar />
          </div>

          {/* AI insights badge */}
          <button
            className="hidden sm:inline-flex items-center"
            style={{
              gap: 7,
              padding: '8px 16px', borderRadius: 999,
              background: 'rgba(255,255,255,0.7)', color: 'var(--ink)',
              border: '1px solid var(--hairline)', cursor: 'pointer',
              fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit',
              backdropFilter: 'blur(10px)', whiteSpace: 'nowrap',
            }}
          >
            <Sparkles size={14} />
            תובנות AI
            <span
              style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                background: 'var(--accent-soft)', color: 'var(--accent-deep)',
                borderRadius: 999, letterSpacing: '0.05em',
              }}
            >
              NEW
            </span>
          </button>

          {/* Notifications */}
          <button
            style={{
              position: 'relative', padding: 8, borderRadius: 10,
              background: 'rgba(255,255,255,0.6)', border: '1px solid var(--hairline)',
              cursor: 'pointer', color: 'var(--ink)',
            }}
          >
            <Bell size={15} />
            <span
              style={{
                position: 'absolute', top: 4, insetInlineEnd: 4,
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--bad)',
              }}
            />
          </button>
        </header>

        {/* Mobile sync bar */}
        <div className="lg:hidden">
          <SyncStatusBar />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto admin-content-pad">
          <Outlet />
        </main>
      </div>

      {bannerVisible && (
        <RememberMeBanner
          description="כדי שלא תצטרך להזין את קוד הגישה בכל כניסה למערכת הניהול"
          onYes={async () => { rememberSession(); setBannerVisible(false) }}
          onNo={() => setBannerVisible(false)}
        />
      )}
    </div>
  )
}
