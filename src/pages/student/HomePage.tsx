import { useEffect, useState } from 'react'
import { StatusButtons } from '@/components/student/StatusButtons'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { formatRelativeTime } from '@/lib/utils/formatTime'
import { getCurrentPosition, isGPSResult } from '@/lib/location/gps'
import type { Student } from '@/types'

const LOCATION_HEARTBEAT_MS = 5 * 60 * 1000 // every 5 minutes

export function HomePage() {
  const { currentUser } = useAuthStore()
  const [student, setStudent] = useState<Student | null>(currentUser)

  const refreshStudent = async () => {
    if (!currentUser) return
    const updated = await api.getStudent(currentUser.id)
    if (updated) setStudent(updated)
  }

  // Send location to server so admin's "ביקורת מיקום" shows up-to-date position
  const sendLocationHeartbeat = async () => {
    if (!currentUser) return
    const result = await getCurrentPosition()
    if (isGPSResult(result)) {
      await api.updateStudentLocation(currentUser.id, result.lat, result.lng)
    }
  }

  useEffect(() => {
    refreshStudent()
  }, [currentUser?.id])

  useEffect(() => {
    if (!currentUser) return
    sendLocationHeartbeat()
    const interval = setInterval(sendLocationHeartbeat, LOCATION_HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [currentUser?.id])

  if (!student) return null

  return (
    <div className="flex flex-col gap-4 p-4 pt-6">
      {/* Current status card */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-[var(--text-muted)]">סטטוס נוכחי</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              עדכון אחרון: {formatRelativeTime(student.lastSeen)}
            </p>
          </div>
          <StatusBadge status={student.currentStatus} />
        </CardContent>
      </Card>

      {/* Status buttons */}
      <div className="flex-1">
        <StatusButtons
          currentStatus={student.currentStatus}
          onStatusChange={async (newStatus) => {
            setStudent((prev) => prev ? { ...prev, currentStatus: newStatus } : prev)
            await refreshStudent()
          }}
        />
      </div>
    </div>
  )
}
