import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { SplashScreen } from '@/components/shared/SplashScreen'
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
const InternalAuditPage   = lazy(() => import('@/features/internal-audit/pages/InternalAuditPage').then(m => ({ default: m.InternalAuditPage })))
const AuditHistoryPage    = lazy(() => import('@/features/internal-audit/pages/AuditHistoryPage').then(m => ({ default: m.AuditHistoryPage })))
const AuditDetailPage     = lazy(() => import('@/features/internal-audit/pages/AuditDetailPage').then(m => ({ default: m.AuditDetailPage })))
const AuditProjectionPage = lazy(() => import('@/features/internal-audit/pages/AuditProjectionPage').then(m => ({ default: m.AuditProjectionPage })))
const PendingRequestsPage = lazy(() => import('@/pages/admin/PendingRequestsPage').then(m => ({ default: m.PendingRequestsPage })))
const ExceptionsPage     = lazy(() => import('@/pages/admin/ExceptionsPage').then(m => ({ default: m.ExceptionsPage })))

// Supervisor
const ClassSupervisorDashboard = lazy(() =>
  import('@/pages/class-supervisor/ClassSupervisorDashboard').then(m => ({ default: m.ClassSupervisorDashboard }))
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
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const { initialize } = useSyncStore()
  const { subscribeToRealtime } = useStudentsStore()
  const { currentUser, restoreSession } = useAuthStore()
  const [showSplash, setShowSplash] = useState(true)
  // Gate routing until a remembered session (student / admin / supervisor) has been
  // re-verified, so guards don't briefly redirect a remembered user to /login.
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let active = true
    restoreSession().finally(() => { if (active) setAuthReady(true) })
    return () => { active = false }
  }, [restoreSession])

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
            <Route path="rollcall" element={<InternalAuditPage />} />
            <Route path="rollcall/history" element={<AuditHistoryPage />} />
            <Route path="rollcall/history/:sessionId" element={<AuditDetailPage />} />
            <Route path="requests" element={<PendingRequestsPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
          </Route>

          {/* Internal-audit projection — full-screen, lives outside the admin shell */}
          <Route
            path="/admin/rollcall/:sessionId/projection"
            element={
              <AdminGuard>
                <AuditProjectionPage />
              </AdminGuard>
            }
          />

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
    </>
  )
}
