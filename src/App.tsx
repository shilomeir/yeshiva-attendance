import { Component, lazy, Suspense, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { SplashScreen } from '@/components/shared/SplashScreen'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useStudentsStore } from '@/store/studentsStore'
import { supabase } from '@/lib/supabase'

// Retry wrapper: retries a failing dynamic import up to 3 times with backoff
function lazyWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      factory().then(resolve).catch((err) => {
        if (n <= 0) { reject(err); return }
        setTimeout(() => attempt(n - 1), (4 - n) * 800)
      })
    }
    attempt(3)
  })
}

// Layouts (small, always needed for the guard shell)
const StudentLayout = lazy(() => lazyWithRetry(() => import('@/components/student/StudentLayout').then(m => ({ default: m.StudentLayout }))))
const AdminLayout   = lazy(() => lazyWithRetry(() => import('@/components/admin/AdminLayout').then(m => ({ default: m.AdminLayout }))))

// Error boundary — catches failed lazy imports and render errors
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100vh', gap: 16,
            background: 'var(--bg)', fontFamily: "'Heebo', system-ui, sans-serif",
            direction: 'rtl',
          }}
        >
          <p style={{ color: 'var(--text)', fontSize: 15, margin: 0 }}>
            אירעה שגיאה בטעינת הדף
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 22px', borderRadius: 10,
              background: 'var(--accent)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
            }}
          >
            רענן דף
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Student pages
const HomePage           = lazy(() => lazyWithRetry(() => import('@/pages/student/HomePage').then(m => ({ default: m.HomePage }))))
const AbsenceRequestPage = lazy(() => lazyWithRetry(() => import('@/pages/student/AbsenceRequestPage').then(m => ({ default: m.AbsenceRequestPage }))))
const HistoryPage        = lazy(() => lazyWithRetry(() => import('@/pages/student/HistoryPage').then(m => ({ default: m.HistoryPage }))))

// Admin pages
const DashboardPage       = lazy(() => lazyWithRetry(() => import('@/pages/admin/DashboardPage').then(m => ({ default: m.DashboardPage }))))
const StudentsPage        = lazy(() => lazyWithRetry(() => import('@/pages/admin/StudentsPage').then(m => ({ default: m.StudentsPage }))))
const CalendarPage        = lazy(() => lazyWithRetry(() => import('@/pages/admin/CalendarPage').then(m => ({ default: m.CalendarPage }))))
const AuditLogPage        = lazy(() => lazyWithRetry(() => import('@/pages/admin/AuditLogPage').then(m => ({ default: m.AuditLogPage }))))
const SettingsPage        = lazy(() => lazyWithRetry(() => import('@/pages/admin/SettingsPage').then(m => ({ default: m.SettingsPage }))))
const RollCallPage        = lazy(() => lazyWithRetry(() => import('@/pages/admin/RollCallPage').then(m => ({ default: m.RollCallPage }))))
const PendingRequestsPage = lazy(() => lazyWithRetry(() => import('@/pages/admin/PendingRequestsPage').then(m => ({ default: m.PendingRequestsPage }))))
const ExceptionsPage      = lazy(() => lazyWithRetry(() => import('@/pages/admin/ExceptionsPage').then(m => ({ default: m.ExceptionsPage }))))

// Supervisor
const ClassSupervisorDashboard = lazy(() =>
  lazyWithRetry(() => import('@/pages/class-supervisor/ClassSupervisorDashboard').then(m => ({ default: m.ClassSupervisorDashboard })))
)

function StudentGuard({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuthStore()
  if (!currentUser) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuthStore()
  if (!isAdmin) return <Navigate to="/login" replace />
  return <>{children}</>
}

function ClassSupervisorGuard({ children }: { children: React.ReactNode }) {
  const { classSupervisor } = useAuthStore()
  if (!classSupervisor) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PageFallback() {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-3"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-9 h-9 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" />
      <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Heebo', system-ui, sans-serif" }}>
        טוען...
      </span>
    </div>
  )
}

export default function App() {
  const { initialize } = useSyncStore()
  const { subscribeToRealtime } = useStudentsStore()
  const { currentUser } = useAuthStore()
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const cleanup = initialize()
    return cleanup
  }, [initialize])

  useEffect(() => {
    const cleanup = subscribeToRealtime()
    return cleanup
  }, [subscribeToRealtime])

  // When the app becomes visible: clear badge + refresh lastSeen for logged-in student
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return
      if ('clearAppBadge' in navigator) {
        ;(navigator as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge().catch(() => {})
      }
    }
    onVisible()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Stamp lastSeen whenever the app becomes visible and a student is logged in
  useEffect(() => {
    if (!currentUser) return
    const stamp = () => {
      if (!document.hidden) {
        supabase.from('students').update({ lastSeen: new Date().toISOString() }).eq('id', currentUser.id).then(() => {})
      }
    }
    stamp()
    document.addEventListener('visibilitychange', stamp)
    return () => document.removeEventListener('visibilitychange', stamp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id])

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}

      <AppErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Routes>
          {/* Auth */}
          <Route path="/login" element={<LoginScreen />} />

          {/* Student routes */}
          <Route
            path="/student"
            element={
              <StudentGuard>
                <StudentLayout />
              </StudentGuard>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="requests" element={<AbsenceRequestPage />} />
            <Route path="history" element={<HistoryPage />} />
          </Route>

          {/* Admin routes */}
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="students" element={<StudentsPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="rollcall" element={<RollCallPage />} />
            <Route path="requests" element={<PendingRequestsPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
          </Route>

          {/* Class supervisor route */}
          <Route
            path="/class-supervisor"
            element={
              <ClassSupervisorGuard>
                <ClassSupervisorDashboard />
              </ClassSupervisorGuard>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </Suspense>
      </AppErrorBoundary>
    </>
  )
}
