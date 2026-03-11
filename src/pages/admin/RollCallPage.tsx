import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MapPin,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Navigation,
  HelpCircle,
  Users,
  Download,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { CAMPUS_LAT, CAMPUS_LNG } from '@/lib/location/gps'
import type { Student } from '@/types'

// Thresholds
const ON_CAMPUS_METERS = 300
const NEARBY_METERS = 2000

type LocationClass = 'בישיבה' | 'קרוב' | 'רחוק' | 'לא ידוע'

interface StudentWithLocation extends Student {
  locationClass: LocationClass
  distanceMeters: number | null
}

function classifyDistance(dist: number | null): LocationClass {
  if (dist === null) return 'לא ידוע'
  if (dist <= ON_CAMPUS_METERS) return 'בישיבה'
  if (dist <= NEARBY_METERS) return 'קרוב'
  return 'רחוק'
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getDistance(student: Student): number | null {
  if (!student.lastLocation) return null
  return Math.round(haversine(CAMPUS_LAT, CAMPUS_LNG, student.lastLocation.lat, student.lastLocation.lng))
}

const CLASS_CONFIG: Record<LocationClass, { color: string; bg: string; icon: React.ReactNode; order: number }> = {
  'בישיבה': { color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, order: 0 },
  'קרוב':   { color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', icon: <Navigation className="h-4 w-4 text-yellow-600" />, order: 1 },
  'רחוק':   { color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: <AlertCircle className="h-4 w-4 text-red-600" />, order: 2 },
  'לא ידוע': { color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200', icon: <HelpCircle className="h-4 w-4 text-gray-400" />, order: 3 },
}

function LocationBadge({ cls }: { cls: LocationClass }) {
  const cfg = CLASS_CONFIG[cls]
  const colors: Record<LocationClass, string> = {
    'בישיבה': 'bg-green-100 text-green-800 border-green-300',
    'קרוב': 'bg-yellow-100 text-yellow-800 border-yellow-300',
    'רחוק': 'bg-red-100 text-red-800 border-red-300',
    'לא ידוע': 'bg-gray-100 text-gray-600 border-gray-300',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[cls]}`}>
      {cfg.icon}
      {cls}
    </span>
  )
}

// How long to wait for students to respond (ms)
const LOCATION_RESPONSE_TIMEOUT_MS = 15000

export function RollCallPage() {
  const [students, setStudents] = useState<StudentWithLocation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isWaiting, setIsWaiting] = useState(false)
  const [lastRun, setLastRun] = useState<Date | null>(null)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState<LocationClass | 'הכל'>('הכל')
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const enrichAndSet = useCallback((all: Student[]) => {
    const enriched: StudentWithLocation[] = all.map((s) => {
      const dist = getDistance(s)
      return { ...s, distanceMeters: dist, locationClass: classifyDistance(dist) }
    })
    enriched.sort((a, b) => {
      const orderDiff = CLASS_CONFIG[a.locationClass].order - CLASS_CONFIG[b.locationClass].order
      if (orderDiff !== 0) return orderDiff
      return a.fullName.localeCompare(b.fullName, 'he')
    })
    setStudents(enriched)
  }, [])

  const runRollCall = useCallback(async () => {
    setIsLoading(true)
    setIsWaiting(false)
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current)

    try {
      // 1. Broadcast to all connected student apps to send their GPS now
      const channel = supabase.channel('location-requests')
      await new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel.send({ type: 'broadcast', event: 'request_location', payload: {} })
            resolve()
          }
        })
      })
      supabase.removeChannel(channel)

      // 2. Load current data immediately (some may already have lastLocation)
      const initial = await api.getStudents()
      enrichAndSet(initial)
      setLastRun(new Date())
      setIsLoading(false)

      // 3. Wait for students to respond, refreshing after timeout
      setIsWaiting(true)
      waitTimerRef.current = setTimeout(async () => {
        const updated = await api.getStudents()
        enrichAndSet(updated)
        setLastRun(new Date())
        setIsWaiting(false)
      }, LOCATION_RESPONSE_TIMEOUT_MS)
    } catch {
      setIsLoading(false)
      setIsWaiting(false)
    }
  }, [enrichAndSet])

  // Listen for realtime updates on the students table to refresh on each location update
  useEffect(() => {
    const channel = supabase
      .channel('students-location-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students' },
        (payload) => {
          const updated = payload.new as Student
          setStudents((prev) =>
            prev.map((s) => {
              if (s.id !== updated.id) return s
              const dist = getDistance(updated)
              return { ...updated, distanceMeters: dist, locationClass: classifyDistance(dist) }
            })
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    runRollCall()
    return () => { if (waitTimerRef.current) clearTimeout(waitTimerRef.current) }
  }, [runRollCall])

  const counts: Record<LocationClass, number> = {
    'בישיבה': students.filter((s) => s.locationClass === 'בישיבה').length,
    'קרוב': students.filter((s) => s.locationClass === 'קרוב').length,
    'רחוק': students.filter((s) => s.locationClass === 'רחוק').length,
    'לא ידוע': students.filter((s) => s.locationClass === 'לא ידוע').length,
  }

  const filtered = students.filter((s) => {
    const matchesClass = filterClass === 'הכל' || s.locationClass === filterClass
    const matchesSearch =
      !search ||
      s.fullName.includes(search) ||
      s.idNumber.includes(search)
    return matchesClass && matchesSearch
  })

  const exportCsv = () => {
    const rows = [
      ['שם', 'ת.ז.', 'טלפון', 'סטטוס נוכחות', 'מיקום', 'מרחק (מטר)', 'זמן עדכון אחרון'],
      ...students.map((s) => [
        s.fullName,
        s.idNumber,
        s.phone,
        s.currentStatus,
        s.locationClass,
        s.distanceMeters ?? '',
        s.lastSeen ? new Date(s.lastSeen).toLocaleString('he-IL') : '',
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ביקורת-${new Date().toLocaleDateString('he-IL').replace(/\//g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)]">ביקורת מיקום</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {lastRun
              ? `עודכן לאחרונה: ${lastRun.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
              : 'טוען נתונים...'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={isLoading || students.length === 0} size="sm">
            <Download className="h-4 w-4" />
            ייצא CSV
          </Button>
          <Button onClick={runRollCall} disabled={isLoading || isWaiting} size="sm">
            <RefreshCw className={`h-4 w-4 ${isLoading || isWaiting ? 'animate-spin' : ''}`} />
            {isLoading ? 'שולח בקשה...' : isWaiting ? 'ממתין לתלמידים...' : 'רענן ביקורת'}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            { label: 'בישיבה', cls: 'בישיבה' as LocationClass, icon: <CheckCircle2 className="h-5 w-5 text-green-600" />, bg: 'bg-green-50', num: counts['בישיבה'] },
            { label: 'קרוב לישיבה', cls: 'קרוב' as LocationClass, icon: <Navigation className="h-5 w-5 text-yellow-600" />, bg: 'bg-yellow-50', num: counts['קרוב'] },
            { label: 'רחוק', cls: 'רחוק' as LocationClass, icon: <AlertCircle className="h-5 w-5 text-red-500" />, bg: 'bg-red-50', num: counts['רחוק'] },
            { label: 'לא ידוע', cls: 'לא ידוע' as LocationClass, icon: <HelpCircle className="h-5 w-5 text-gray-400" />, bg: 'bg-gray-50', num: counts['לא ידוע'] },
          ] as const
        ).map(({ label, cls, icon, bg, num }) => (
          <button
            key={cls}
            onClick={() => setFilterClass(filterClass === cls ? 'הכל' : cls)}
            className={`rounded-xl border p-4 text-start transition-all hover:shadow-md ${bg} ${filterClass === cls ? 'ring-2 ring-[var(--blue)]' : 'border-[var(--border)]'}`}
          >
            <div className="flex items-center justify-between">
              {icon}
              <span className="text-2xl font-bold text-[var(--text)]">{num}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--text-muted)]">{label}</p>
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-[var(--blue)]" />
          <span>מיקום מבוסס על נתוני GPS אחרונים שנשמרו</span>
        </div>
        <span>·</span>
        <span className="text-green-700">בישיבה ≤ {ON_CAMPUS_METERS}מ׳</span>
        <span>·</span>
        <span className="text-yellow-700">קרוב ≤ {NEARBY_METERS / 1000}ק״מ</span>
        <span>·</span>
        <span className="text-red-700">רחוק &gt; {NEARBY_METERS / 1000}ק״מ</span>
      </div>

      {/* Search + filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Users className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            placeholder="חפש שם או ת.ז..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>
        {filterClass !== 'הכל' && (
          <Button variant="outline" size="sm" onClick={() => setFilterClass('הכל')}>
            נקה פילטר
          </Button>
        )}
        <span className="text-sm text-[var(--text-muted)] whitespace-nowrap">
          {filtered.length} תלמידים
        </span>
      </div>

      {/* Students list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {filterClass === 'הכל' ? 'כל התלמידים' : filterClass}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-[var(--blue)]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-[var(--text-muted)]">
              <MapPin className="h-8 w-8 opacity-30" />
              <p>לא נמצאו תלמידים</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {filtered.map((student) => {
                const cfg = CLASS_CONFIG[student.locationClass]
                return (
                  <div
                    key={student.id}
                    className={`flex items-center gap-3 px-4 py-3 ${cfg.bg} border-s-4 ${
                      student.locationClass === 'בישיבה' ? 'border-s-green-500' :
                      student.locationClass === 'קרוב' ? 'border-s-yellow-500' :
                      student.locationClass === 'רחוק' ? 'border-s-red-500' :
                      'border-s-gray-300'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--blue)] text-xs font-bold text-white">
                      {student.fullName.slice(0, 2)}
                    </div>

                    {/* Info */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-[var(--text)]">{student.fullName}</span>
                      <span className="text-xs text-[var(--text-muted)]">ת.ז. {student.idNumber}</span>
                    </div>

                    {/* Distance */}
                    <div className="flex flex-col items-end gap-1">
                      <LocationBadge cls={student.locationClass} />
                      {student.distanceMeters !== null && (
                        <span className="text-xs text-[var(--text-muted)]">
                          {student.distanceMeters >= 1000
                            ? `${(student.distanceMeters / 1000).toFixed(1)} ק״מ`
                            : `${student.distanceMeters} מ׳`}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
