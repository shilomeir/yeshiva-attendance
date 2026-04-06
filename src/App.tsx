import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { StudentLayout } from '@/components/student/StudentLayout'
import { AdminLayout } from '@/components/admin/AdminLayout'
import { SplashScreen } from '@/components/shared/SplashScreen'
import { HomePage } from '@/pages/student/HomePage'
import { AbsenceRequestPage } from '@/pages/student/AbsenceRequestPage'
import { HistoryPage } from '@/pages/student/HistoryPage'
import { DashboardPage } from '@/pages/admin/DashboardPage'
import { StudentsPage } from '@/pages/admin/StudentsPage'
import { CalendarPage } from '@/pages/admin/CalendarPage'
import { AuditLogPage } from '@/pages/admin/AuditLogPage'
import { SmsPage } from '@/pages/admin/SmsPage'
import { SettingsPage } from '@/pages/admin/SettingsPage'
import { RollCallPage } from '@/pages/admin/RollCallPage'
import { PendingRequestsPage } from '@/pages/admin/PendingRequestsPage'
import { ExceptionsPage } from '@/pages/admin/ExceptionsPage'
import { ClassSupervisorDashboard } from '@/pages/class-supervisor/ClassSupervisorDashboard'
import { useAuthStore } from '@/store/authStore'
import { useSyncStore } from '@/store/syncStore'
import { useStudentsStore } from '@/store/studentsStore'

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

export default function App() {
  const { initialize } = useSyncStore()
  const { subscribeToRealtime } = useStudentsStore()
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const cleanup = initialize()
    return cleanup
  }, [initialize])

  useEffect(() => {
    const cleanup = subscribeToRealtime()
    return cleanup
  }, [subscribeToRealtime])

  // Clear app badge whenever the app becomes visible
  useEffect(() => {
    const clearBadge = () => {
      if (!document.hidden && 'clearAppBadge' in navigator) {
        ;(navigator as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge().catch(() => {})
      }
    }
    clearBadge()
    document.addEventListener('visibilitychange', clearBadge)
    return () => document.removeEventListener('visibilitychange', clearBadge)
  }, [])

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}

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
          <Route path="sms" element={<SmsPage />} />
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

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}
