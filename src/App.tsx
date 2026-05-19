import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { PinPromptProvider } from '@/components/auth/PinPromptDialog'
import { SplashScreen } from '@/components/shared/SplashScreen'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useStudentsStore } from '@/store/studentsStore'
import { supabase } from '@/lib/supabase'

// Layouts (small, always needed for the guard shell)
const StudentLayout = lazy(() => import('@/components/student/StudentLayout').then(m => ({ default: m.StudentLayout })))
const AdminLayout   = lazy(() => import('@/components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })))

// Student pages
const HomePage           = lazy(() => import('@/pages/student/HomePage').then(m => ({ default: m.HomePage })))
const AbsenceRequestPage = lazy(() => import('@/pages/student/AbsenceRequestPage').then(m => ({ default: m.AbsenceRequestPage })))
const HistoryPage        = lazy(() => import('@/pages/student/HistoryPage').then(m => ({ default: m.HistoryPage })))

// Admin pages
const DashboardPage      = lazy(() => import('@/pages/admin/DashboardPage').then(m => ({ default: m.DashboardPage })))
const StudentsPage       = lazy(() => import('@/pages/admin/StudentsPage').then(m => ({ default: m.StudentsPage })))
const CalendarPage       = lazy(() => import('@/pages/admin/CalendarPage').then(m => ({ default: m.CalendarPage })))
const AuditLogPage       = lazy(() => import('@/pages/admin/AuditLogPage').then(m => ({ default: m.AuditLogPage })))
const SettingsPage       = lazy(() => import('@/pages/admin/SettingsPage').then(m => ({ default: m.SettingsPage })))
const RollCallPage       = lazy(() => import('@/pages/admin/RollCallPage').then(m => ({ default: m.RollCallPage })))
const PendingRequestsPage = lazy(() => import('@/pages/admin/PendingRequestsPage').then(m => ({ default: m.PendingRequestsPage })))
const ExceptionsPage     = lazy(() => import('@/pages/admin/ExceptionsPage').then(m => ({ default: m.ExceptionsPage })))
const AuditHistoryPage   = lazy(() => import('@/pages/admin/AuditHistoryPage').then(m => ({ default: m.AuditHistoryPage })))
const AuditDetailPage    = lazy(() => import('@/pages/admin/AuditDetailPage').then(m => ({ default: m.AuditDetailPage })))

// Supervisor
const ClassSupervisorDashboard = lazy(() =>
  import('@/pages/class-supervisor/ClassSupervisorDashboard').then(m => ({ default: m.ClassSupervisorDashboard }))
)

// Each guard preserves the intended URL via location state so the login screen
// can bounce the user back after re-auth (master plan B-29). Without this, a
// supervisor bookmarking /class-supervisor and refreshing landed on /student
// after re-login instead of their dashboard.

function StudentGuard({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuthStore()
  const location = useLocation()
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuthStore()
  const location = useLocation()
  if (!isAdmin) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function ClassSupervisorGuard({ children }: { children: React.ReactNode }) {
  const { classSupervisor } = useAuthStore()
  const location = useLocation()
  if (!classSupervisor) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const { initialize } = useSyncStore()
  const { subscribeToRealtime } = useStudentsStore()
  const { currentUser, restoreAuth } = useAuthStore()
  const [showSplash, setShowSplash] = useState(true)
  const [authReady, setAuthReady] = useState(false)

  // Re-hydrate isAdmin from Supabase Auth before letting any guard route fire.
  // Without this gate the admin's first paint after refresh sees isAdmin=false
  // and AdminGuard redirects to /login even though the underlying Supabase
  // session is still valid. Supervisor refresh is handled separately —
  // classSupervisor is persisted by authStore so the ClassSupervisorGuard
  // sees it on first paint without needing this hook.
  useEffect(() => {
    let cancelled = false
    restoreAuth().finally(() => { if (!cancelled) setAuthReady(true) })
    return () => { cancelled = true }
  }, [restoreAuth])

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
    <ErrorBoundary>
    <PinPromptProvider>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}

      {!authReady ? (
        <PageFallback />
      ) : (
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
            {/* New audit feature lives at /admin/inspection (master plan R-2).
                /admin/audit is the legacy log; /admin/inspection is the new
                "ביקורת פנימית". Old /admin/rollcall + /admin/audits paths
                redirect for any users with stale bookmarks. */}
            <Route path="inspection" element={<RollCallPage />} />
            <Route path="inspection/history" element={<AuditHistoryPage />} />
            <Route path="inspection/history/:id" element={<AuditDetailPage />} />
            <Route path="rollcall" element={<Navigate to="/admin/inspection" replace />} />
            <Route path="audits" element={<Navigate to="/admin/inspection/history" replace />} />
            <Route path="audits/:id" element={<Navigate to="/admin/inspection/history" replace />} />
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
      )}
    </PinPromptProvider>
    </ErrorBoundary>
  )
}
