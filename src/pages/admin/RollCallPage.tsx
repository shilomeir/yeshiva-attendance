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
  ClipboardList,
  Clock,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { CAMPUS_LAT, CAMPUS_LNG } from '@/lib/location/gps'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { Student, ClassStat } from '@/types'

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

const CLASS_CONFIG: Record<LocationClass, { color: string; order: number }> = {
  'בישיבה': { color: 'var(--good)', order: 0 },
  'קרוב':   { color: 'var(--warn)', order: 1 },
  'רחוק':   { color: 'var(--bad)',  order: 2 },
  'לא ידוע': { color: 'var(--ink-faint)', order: 3 },
}

const LOCATION_RESPONSE_TIMEOUT_MS = 15000

export function RollCallPage() {
  const [students, setStudents] = useState<StudentWithLocation[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [lastRun, setLastRun] = useState<Date | null>(null)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState<LocationClass | 'הכל'>('הכל')
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showAuditModal, setShowAuditModal] = useState(false)
  const [auditMode, setAuditMode] = useState<'location' | 'manual' | null>(null)
  const [allClassStats, setAllClassStats] = useState<ClassStat[]>([])
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set())
  const [manualAuditSent, setManualAuditSent] = useState(false)

  useEffect(() => {
    if (!showAuditModal) return
    api.getClassStats()
      .then((stats) => {
        setAllClassStats(stats)
        setSelectedClassIds(new Set(stats.map((s) => s.classId)))
      })
      .catch((err) => {
        toast({ title: 'שגיאה בטעינת כיתות', description: getErrorMessage(err, 'טעינת רשימת הכיתות נכשלה'), variant: 'destructive' })
      })
  }, [showAuditModal])

  const handleOpenModal = () => {
    setAuditMode(null)
    setManualAuditSent(false)
    setShowAuditModal(true)
  }

  const handleConfirmAudit = async () => {
    setShowAuditModal(false)
    if (auditMode === 'location') {
      runRollCall()
    } else {
      const classIds = [...selectedClassIds]
      const ch = supabase.channel('audit-control')
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            ch.send({ type: 'broadcast', event: 'manual_audit_start', payload: { classIds } })
            resolve()
          }
        })
      })
      supabase.removeChannel(ch)
      setManualAuditSent(true)
      setLastRun(new Date())
    }
  }

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

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

      const initial = await api.getStudents()
      enrichAndSet(initial)
      setLastRun(new Date())
      setIsLoading(false)

      setIsWaiting(true)
      waitTimerRef.current = setTimeout(async () => {
        try {
          const updated = await api.getStudents()
          enrichAndSet(updated)
          setLastRun(new Date())
        } catch (err) {
          toast({ title: 'שגיאה בעדכון תוצאות ביקורת', description: getErrorMessage(err, 'טעינת מיקומי התלמידים לאחר הביקורת נכשלה'), variant: 'destructive' })
        } finally {
          setIsWaiting(false)
        }
      }, LOCATION_RESPONSE_TIMEOUT_MS)
    } catch (err) {
      toast({ title: 'שגיאה בהפעלת ביקורת', description: getErrorMessage(err, 'שליחת בקשת מיקום לתלמידים נכשלה'), variant: 'destructive' })
      setIsLoading(false)
      setIsWaiting(false)
    }
  }, [enrichAndSet])

  useEffect(() => {
    const channel = supabase
      .channel('students-location-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' }, (payload) => {
        const updated = payload.new as Student
        setStudents((prev) =>
          prev.map((s) => {
            if (s.id !== updated.id) return s
            const dist = getDistance(updated)
            return { ...updated, distanceMeters: dist, locationClass: classifyDistance(dist) }
          })
        )
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    return () => { if (waitTimerRef.current) clearTimeout(waitTimerRef.current) }
  }, [])

  const counts: Record<LocationClass, number> = {
    'בישיבה':  students.filter((s) => s.locationClass === 'בישיבה').length,
    'קרוב':    students.filter((s) => s.locationClass === 'קרוב').length,
    'רחוק':    students.filter((s) => s.locationClass === 'רחוק').length,
    'לא ידוע': students.filter((s) => s.locationClass === 'לא ידוע').length,
  }

  const filtered = students.filter((s) => {
    const matchesClass = filterClass === 'הכל' || s.locationClass === filterClass
    const matchesSearch = !search || s.fullName.includes(search) || s.idNumber.includes(search)
    return matchesClass && matchesSearch
  })

  const exportCsv = () => {
    const rows = [
      ['שם', 'ת.ז.', 'טלפון', 'סטטוס נוכחות', 'מיקום', 'מרחק (מטר)', 'זמן עדכון אחרון'],
      ...students.map((s) => [
        s.fullName, s.idNumber, s.phone, s.currentStatus,
        s.locationClass, s.distanceMeters ?? '',
        s.lastSeen ? new Date(s.lastSeen).toLocaleString('he-IL') : '',
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ביקורת-${new Date().toLocaleDateString('he-IL').replace(/\//g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRunning = isLoading || isWaiting

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
            מצב המתנה
          </div>
          <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>
            ביקורת פנימית
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5, maxWidth: 580 }}>
            בקרה זו פעילה רק בעת הפעלת מצב ביקורת. שליחת בקשת מיקום לכלל התלמידים תאסוף את התשובות ותציג אותן כאן.
          </p>
        </div>
        {students.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={exportCsv} disabled={isRunning} size="sm">
              <Download className="h-4 w-4" />
              ייצא CSV
            </Button>
            <Button onClick={handleOpenModal} disabled={isRunning} size="sm">
              <MapPin className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
              {isLoading ? 'שולח בקשה...' : isWaiting ? 'ממתין...' : 'ביקורת חדשה'}
            </Button>
          </div>
        )}
      </div>

      {/* ── Empty state hero ─────────────────────────────────────────── */}
      {students.length === 0 && !isLoading && (
        <div className="glass" style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '64px 32px', textAlign: 'center',
          position: 'relative', overflow: 'hidden', minHeight: 480,
          background: 'radial-gradient(120% 80% at 50% 0%, var(--accent-soft) 0%, transparent 55%), var(--glass-2)',
        }}>
          {/* Ambient rings */}
          <svg width="280" height="280" viewBox="0 0 280 280" style={{ position: 'absolute', opacity: 0.6, pointerEvents: 'none' }}>
            {[40, 80, 120].map((r, i) => (
              <circle key={r} cx="140" cy="140" r={r} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 6" opacity={0.18 - i * 0.04} />
            ))}
          </svg>

          {/* Center icon */}
          <div style={{
            width: 80, height: 80, borderRadius: 24,
            background: 'linear-gradient(135deg, var(--ink), var(--accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', position: 'relative', zIndex: 1,
            boxShadow: '0 14px 36px -10px rgba(79,70,229,0.5)',
            marginBottom: 24,
          }}>
            <MapPin size={32} />
          </div>

          <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 8, position: 'relative', zIndex: 1, fontFamily: 'Fraunces, serif', color: 'var(--ink)' }}>
            אין ביקורת פעילה
          </h2>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)', maxWidth: 460, marginBottom: 28, lineHeight: 1.55, position: 'relative', zIndex: 1 }}>
            {lastRun
              ? `הביקורת האחרונה הופעלה לפני ${Math.floor((Date.now() - lastRun.getTime()) / 60000)} דקות. הפעלת ביקורת חדשה תשלח בקשת מיקום לתלמידים.`
              : 'הפעלת ביקורת תשלח בקשת מיקום לכלל התלמידים ותציג כאן את התוצאות.'}
          </p>

          <button
            onClick={handleOpenModal}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '14px 28px', borderRadius: 999,
              background: 'linear-gradient(135deg, var(--ink), var(--accent))',
              color: 'white', fontFamily: 'inherit',
              fontWeight: 600, fontSize: 15,
              border: 'none', cursor: 'pointer',
              boxShadow: '0 12px 28px -8px rgba(79,70,229,0.4)',
              transition: 'transform 0.18s, box-shadow 0.18s',
              position: 'relative', zIndex: 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
          >
            <MapPin size={16} />
            הפעל מצב ביקורת פנימית
          </button>

          {/* Hints */}
          <div style={{
            marginTop: 36, display: 'flex', gap: 12, position: 'relative', zIndex: 1,
            fontSize: 12, color: 'var(--ink-faint)', flexWrap: 'wrap', justifyContent: 'center',
          }}>
            {[
              { icon: <MapPin size={12} />, label: 'כל התלמידים יקבלו את הבקשה' },
              { icon: <Clock size={12} />, label: 'תגובה תוך ~15 שניות' },
              { icon: <Shield size={12} />, label: 'נשמר בלוג הביקורת' },
            ].map((hint, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 999,
                background: 'rgba(255,255,255,0.5)',
                border: '1px solid var(--hairline)',
              }}>
                {hint.icon}{hint.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading state ─────────────────────────────────────────────── */}
      {isLoading && (
        <div className="glass" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '64px 32px', textAlign: 'center', minHeight: 360,
          position: 'relative', overflow: 'hidden',
          background: 'radial-gradient(120% 80% at 50% 0%, var(--accent-soft) 0%, transparent 55%), var(--glass-2)',
        }}>
          <svg width="280" height="280" viewBox="0 0 280 280" style={{ position: 'absolute', opacity: 0.6, pointerEvents: 'none' }}>
            {[40, 80, 120].map((r, i) => (
              <circle key={r} cx="140" cy="140" r={r} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 6" opacity={0.18 - i * 0.04} />
            ))}
          </svg>
          <div style={{ position: 'relative', zIndex: 1, marginBottom: 24 }}>
            <div style={{
              width: 80, height: 80, borderRadius: 24,
              background: 'linear-gradient(135deg, var(--ink), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white',
              boxShadow: '0 14px 36px -10px rgba(79,70,229,0.5)',
            }}>
              <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', fontFamily: 'Fraunces, serif', color: 'var(--ink)', position: 'relative', zIndex: 1 }}>
            אוסף מיקומים...
          </h2>
          <p style={{ fontSize: 14, color: 'var(--ink-muted)', maxWidth: 460, marginTop: 8, position: 'relative', zIndex: 1 }}>
            נשלחה בקשת מיקום לכל התלמידים. התוצאות יופיעו כאן תוך כ-15 שניות.
          </p>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────── */}
      {students.length > 0 && !isLoading && (
        <>
          {/* Waiting banner */}
          {isWaiting && (
            <div className="glass" style={{
              padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10,
              borderInlineStart: '3px solid var(--accent)',
              background: 'linear-gradient(90deg, var(--accent-soft) 0%, transparent 60%), var(--glass-2)',
            }}>
              <RefreshCw size={14} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>ממתין לתגובות תלמידים...</span>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)', marginInlineStart: 4 }}>
                עדכון אוטומטי תוך שניות
              </span>
            </div>
          )}

          {/* Summary stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--gap-sm)' }}>
            {([
              { label: 'בישיבה', cls: 'בישיבה' as LocationClass, icon: <CheckCircle2 size={20} />, tone: 'var(--good)' },
              { label: 'קרוב לישיבה', cls: 'קרוב' as LocationClass, icon: <Navigation size={20} />, tone: 'var(--warn)' },
              { label: 'רחוק', cls: 'רחוק' as LocationClass, icon: <AlertCircle size={20} />, tone: 'var(--bad)' },
              { label: 'לא ידוע', cls: 'לא ידוע' as LocationClass, icon: <HelpCircle size={20} />, tone: 'var(--ink-faint)' },
            ] as const).map(({ label, cls, icon, tone }) => (
              <button
                key={cls}
                onClick={() => setFilterClass(filterClass === cls ? 'הכל' : cls)}
                className="glass"
                style={{
                  padding: 'var(--card-pad)', cursor: 'pointer', textAlign: 'right',
                  border: filterClass === cls ? `2px solid ${tone}` : '1px solid var(--hairline)',
                  transition: 'all 0.18s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: tone }}>{icon}</span>
                  <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {counts[cls]}
                  </span>
                </div>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>{label}</p>
              </button>
            ))}
          </div>

          {/* Search + filter */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, position: 'relative', minWidth: 200 }}>
              <Users size={15} style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)', pointerEvents: 'none' }} />
              <input
                placeholder="חפש שם או ת.ז..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '9px 12px 9px 38px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)',
                  fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
                  color: 'var(--ink)', direction: 'rtl',
                }}
              />
            </div>
            {filterClass !== 'הכל' && (
              <button
                onClick={() => setFilterClass('הכל')}
                style={{
                  padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.6)', border: '1px solid var(--hairline)',
                  fontSize: 12.5, fontFamily: 'inherit', color: 'var(--ink-muted)',
                }}
              >
                נקה פילטר
              </button>
            )}
            <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{filtered.length} תלמידים</span>
          </div>

          {/* Students list */}
          <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>
                {filterClass === 'הכל' ? 'כל התלמידים' : filterClass}
              </h3>
            </div>
            {filtered.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 48, color: 'var(--ink-faint)' }}>
                <MapPin size={28} style={{ opacity: 0.4 }} />
                <p>לא נמצאו תלמידים</p>
              </div>
            ) : (
              <div>
                {filtered.map((student) => {
                  const color = CLASS_CONFIG[student.locationClass].color
                  return (
                    <div
                      key={student.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '12px 18px',
                        borderBottom: '1px solid var(--hairline)',
                        borderInlineStart: `3px solid ${color}`,
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--accent)', color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                      }}>
                        {student.fullName.slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{student.fullName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>ת.ז. {student.idNumber}</div>
                      </div>
                      <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                          background: color + '18', color,
                          border: `1px solid ${color}33`,
                        }}>
                          {student.locationClass}
                        </span>
                        {student.distanceMeters !== null && (
                          <span className="font-mono-num" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
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
          </div>
        </>
      )}

      {/* ── Manual audit sent banner ─────────────────────────────────── */}
      {manualAuditSent && (
        <div className="glass" style={{
          padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12,
          borderInlineStart: '3px solid var(--info)',
          background: 'linear-gradient(90deg, var(--info-soft) 0%, transparent 60%), var(--glass-2)',
        }}>
          <ClipboardList size={18} style={{ color: 'var(--info)', flexShrink: 0 }} />
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--info)' }}>ביקורת ידנית הופעלה</p>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
              נשלחה הודעה לאחראי הכיתות. עליהם לסמן נוכחות מלוח הבקרה שלהם.
            </p>
          </div>
        </div>
      )}

      {/* ── Pre-audit modal ───────────────────────────────────────────── */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 500 }}>הפעלת ביקורת</DialogTitle>
            <DialogDescription>בחר את אופן הביקורת והכיתות שישתתפו</DialogDescription>
          </DialogHeader>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Mode selection */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 8 }}>
                1. אופן איסוף
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { key: 'location' as const, label: 'עם מיקום', desc: 'שליחת בקשת GPS', icon: <MapPin size={18} /> },
                  { key: 'manual' as const, label: 'ללא מיקום', desc: 'אחראי כיתה מסמן', icon: <ClipboardList size={18} /> },
                ].map((o) => {
                  const active = auditMode === o.key
                  return (
                    <button key={o.key} onClick={() => setAuditMode(o.key)} style={{
                      padding: 14, borderRadius: 12, textAlign: 'right',
                      background: active ? 'var(--accent-soft)' : 'rgba(255,255,255,0.6)',
                      border: '1.5px solid ' + (active ? 'var(--accent)' : 'var(--hairline)'),
                      color: active ? 'var(--accent-deep)' : 'var(--ink)',
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'all 0.18s',
                    }}>
                      <div style={{ marginBottom: 4 }}>{o.icon}</div>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.label}</div>
                      <div style={{ fontSize: 11.5, color: active ? 'var(--accent-deep)' : 'var(--ink-faint)', marginTop: 2 }}>{o.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Class selection */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                  2. כיתות משתתפות
                </div>
                <button
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                  onClick={() => setSelectedClassIds(
                    selectedClassIds.size === allClassStats.length
                      ? new Set()
                      : new Set(allClassStats.map((s) => s.classId))
                  )}
                >
                  {selectedClassIds.size === allClassStats.length ? 'בטל הכל' : 'בחר הכל'}
                </button>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--hairline)', borderRadius: 12, padding: 8 }}>
                {allClassStats.length === 0 ? (
                  <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-faint)' }}>טוען כיתות...</p>
                ) : (
                  allClassStats.map((cs) => (
                    <label key={cs.classId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedClassIds.has(cs.classId)}
                        onChange={() => toggleClass(cs.classId)}
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 13, flex: 1, color: 'var(--ink)' }}>{cs.classId}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{cs.grade}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setShowAuditModal(false)}>ביטול</Button>
              <Button
                onClick={handleConfirmAudit}
                disabled={!auditMode || selectedClassIds.size === 0}
                style={{ background: 'var(--accent)' }}
              >
                הפעל ביקורת על {selectedClassIds.size} כיתות
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
