import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Users, UserCheck, UserX, CalendarOff, Phone,
  AlertOctagon, CheckCircle2, XCircle, MapPin, Bell, Send, Loader2,
  GraduationCap, School, UserRound, Download, RefreshCw,
  ClipboardList, AlertTriangle, Sparkles,
} from 'lucide-react'
import { PresenceChart } from '@/components/analytics/PresenceChart'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useDeparturesRealtime } from '@/hooks/useDeparturesRealtime'
import { calcQuota } from '@/lib/quota'
import { CAMPUS_LAT, CAMPUS_LNG, AREA_RADIUS_METERS } from '@/lib/location/gps'
import type { DashboardStats, Student, CalendarDeparture, ClassStat } from '@/types'
import type { PushNotificationTarget } from '@/lib/api/types'

type BroadcastTargetMode = 'all' | 'grade' | 'class' | 'student'

function getTimeStr(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function minsFromNow(isoStr: string): number {
  return Math.round((new Date(isoStr).getTime() - Date.now()) / 60000)
}
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'))
}
function getBroadcastTargetStudents(
  students: Student[], mode: BroadcastTargetMode,
  selectedGrade: string, selectedClass: string, selectedStudentId: string,
): Student[] {
  if (mode === 'all') return students
  if (mode === 'grade') return selectedGrade ? students.filter((s) => s.grade === selectedGrade) : []
  if (mode === 'class') return selectedClass ? students.filter((s) => s.classId === selectedClass) : []
  if (mode === 'student') return selectedStudentId ? students.filter((s) => s.id === selectedStudentId) : []
  return []
}
function getBroadcastTargetPayload(
  mode: BroadcastTargetMode, selectedGrade: string, selectedClass: string, selectedStudentId: string,
): PushNotificationTarget | undefined {
  if (mode === 'grade' && selectedGrade) return { grade: selectedGrade }
  if (mode === 'class' && selectedClass) return { classId: selectedClass }
  if (mode === 'student' && selectedStudentId) return { studentIds: [selectedStudentId] }
  return undefined
}

// ── Glass Avatar ─────────────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colors = ['#4F46E5', '#7C3AED', '#0891B2', '#16A34A', '#EA580C', '#DC2626']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'white', fontSize: size * 0.38, fontWeight: 600,
    }}>
      {name.slice(0, 2)}
    </div>
  )
}

// ── Hero Presence (animated SVG ring + grade breakdown) ──────────────────────
function HeroPresence({
  displayPct, onCampusPct, stats, classStats,
}: {
  displayPct: number; onCampusPct: number; stats: DashboardStats | null; classStats: ClassStat[]
}) {
  const color = displayPct <= 40 ? 'var(--bad)' : displayPct <= 70 ? 'var(--warn)' : 'var(--good)'
  const colorSoft = displayPct <= 40 ? 'var(--bad-soft)' : displayPct <= 70 ? 'var(--warn-soft)' : 'var(--good-soft)'
  const R = 84; const C = 2 * Math.PI * R
  const dash = (displayPct / 100) * C

  const gradeAgg = useMemo(() => {
    const grades = [...new Set(classStats.map(cs => cs.grade))].sort()
    return grades.map(g => {
      const cls = classStats.filter(cs => cs.grade === g)
      const total = cls.reduce((s, c) => s + c.total, 0)
      const onCampus = cls.reduce((s, c) => s + c.onCampus, 0)
      return { grade: g, total, onCampus, pct: total > 0 ? Math.round((onCampus / total) * 100) : 0 }
    })
  }, [classStats])

  return (
    <div style={{
      padding: 'var(--card-pad)', position: 'relative', overflow: 'hidden',
      background: `radial-gradient(120% 100% at 100% 0%, ${colorSoft} 0%, transparent 60%), var(--glass-2)`,
      backdropFilter: 'blur(20px) saturate(140%)', WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>נוכחות עכשיו</div>
          <h2 style={{ marginTop: 4, fontSize: 17, fontWeight: 500 }}>
            <span style={{ color: 'var(--ink-muted)' }}>{stats?.onCampus ?? '—'}</span>
            <span style={{ color: 'var(--ink-faint)', margin: '0 6px' }}>/</span>
            <span style={{ color: 'var(--ink-muted)' }}>{stats?.total ?? '—'}</span>
            <span style={{ color: 'var(--ink-faint)', fontWeight: 400, marginInlineStart: 8 }}>תלמידים בישיבה</span>
          </h2>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
          background: onCampusPct > 70 ? 'var(--good-soft)' : onCampusPct > 40 ? 'var(--warn-soft)' : 'var(--bad-soft)',
          color: onCampusPct > 70 ? 'var(--good)' : onCampusPct > 40 ? 'var(--warn)' : 'var(--bad)',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'admin-shimmer-pulse 1.4s ease-in-out infinite' }}/>
          בזמן אמת
        </span>
      </div>

      <div className="admin-hero-presence-body">
        <div className="admin-hero-ring">
          <svg viewBox="0 0 200 200" style={{ transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={color}/>
                <stop offset="100%" stopColor={color} stopOpacity="0.6"/>
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r={R} stroke="rgba(20,18,25,0.07)" strokeWidth="14" fill="none"/>
            <circle cx="100" cy="100" r={R}
              stroke="url(#ring-grad)" strokeWidth="14" fill="none"
              strokeDasharray={`${dash} ${C}`} strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.4s ease', filter: `drop-shadow(0 0 12px ${color})` }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              fontFamily: 'Fraunces, serif', fontSize: 'clamp(38px, 9vw, 64px)', fontWeight: 500, color, lineHeight: 1, letterSpacing: '-0.04em',
              transition: 'color 0.4s ease',
            }}>{displayPct}<span style={{ fontSize: 'clamp(18px, 4vw, 28px)', color: 'var(--ink-faint)', marginInlineStart: 2 }}>%</span></div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>בישיבה</div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>פילוח לפי שכבה</div>
          {gradeAgg.map(g => (
            <div key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 500, width: 72, color: 'var(--ink-muted)', fontSize: 11 }}>{g.grade}</div>
              <div style={{ flex: 1, height: 7, background: 'rgba(20,18,25,0.06)', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${g.pct}%`,
                  background: g.pct > 70 ? 'linear-gradient(90deg, var(--good) 0%, #34D399 100%)' : g.pct > 40 ? 'var(--warn)' : 'var(--bad)',
                  borderRadius: 999, transition: 'width 1.2s cubic-bezier(0.22,1,0.36,1)',
                }}/>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, fontWeight: 600, width: 32, textAlign: 'start', color: 'var(--ink)' }}>{g.pct}%</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-faint)', width: 46, textAlign: 'start' }}>{g.onCampus}/{g.total}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Location Dial (2 categories) ─────────────────────────────────────────────
function LocationDial({ stats }: { stats: DashboardStats | null }) {
  const onCampus = stats?.onCampus ?? 0
  const total = stats?.total ?? 1
  const offCampus = total - onCampus
  const cats = [
    { key: 'on', label: 'בישיבה', val: onCampus, color: 'var(--good)', pct: Math.round(onCampus / total * 100) },
    { key: 'off', label: 'מחוץ לישיבה', val: offCampus, color: 'var(--warn)', pct: Math.round(offCampus / total * 100) },
  ]
  const R = 70; const C = 2 * Math.PI * R
  let offset = 0
  const arcs = cats.map(c => {
    const len = (c.val / total) * C
    const arc = { ...c, dashArray: `${Math.max(0, len - 4)} ${C}`, dashOffset: offset, len }
    offset -= len
    return arc
  })

  return (
    <div style={{
      padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column',
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>נוכחות</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>בישיבה / מחוץ לישיבה</h3>
        </div>
        <MapPin size={16} style={{ color: 'var(--ink-faint)' }}/>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1 }}>
        <div className="admin-location-ring">
          <svg viewBox="0 0 160 160" style={{ transform: 'rotate(-90deg)' }}>
            {arcs.map((a) => (
              <circle key={a.key} cx="80" cy="80" r={R}
                stroke={a.color} strokeWidth="14" fill="none"
                strokeDasharray={a.dashArray}
                strokeDashoffset={a.dashOffset}
                strokeLinecap="round"
              />
            ))}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 30, fontWeight: 600, lineHeight: 1 }}>{total}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>סה"כ</div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cats.map(c => (
            <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}/>
                <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', fontWeight: 500 }}>{c.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingInlineStart: 14 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 600, color: c.color, letterSpacing: '-0.02em' }}>{c.val}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-faint)' }}>{c.pct}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Quick Stats ───────────────────────────────────────────────────────────────
function QuickStats({
  urgentRequests, longAbsentStudents, allStudents, todayDepartures,
}: {
  urgentRequests: CalendarDeparture[]; longAbsentStudents: Student[]
  allStudents: Student[]; todayDepartures: CalendarDeparture[]
}) {
  const registeredDevices = allStudents.filter(s => Boolean(s.push_token)).length
  const devicePct = allStudents.length > 0 ? Math.round((registeredDevices / allStudents.length) * 100) : 0
  const stats = [
    { label: 'יציאות היום', val: todayDepartures.length, trend: 'פעיל', tone: 'accent', Icon: ClipboardList },
    { label: 'ממתינים לאישור', val: urgentRequests.length, trend: `${urgentRequests.length} חריגים`, tone: 'warn', Icon: Bell },
    { label: 'נעדרים 7+ ימים', val: longAbsentStudents.length, trend: '', tone: 'bad', Icon: AlertOctagon },
    { label: 'מכשירים רשומים', val: registeredDevices, trend: `${devicePct}%`, tone: 'good', Icon: Users },
  ]
  const colorMap: Record<string, string> = { accent: 'var(--accent)', warn: 'var(--warn)', bad: 'var(--bad)', good: 'var(--good)' }
  const softMap: Record<string, string> = { accent: 'var(--accent-soft)', warn: 'var(--warn-soft)', bad: 'var(--bad-soft)', good: 'var(--good-soft)' }

  return (
    <div style={{
      padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 12,
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>סיכום מהיר</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>מדדים עיקריים</h3>
        </div>
        <Sparkles size={16} style={{ color: 'var(--ink-faint)' }}/>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, justifyContent: 'space-around' }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '6px 0',
            borderBottom: i === stats.length - 1 ? 'none' : '1px solid var(--hairline)',
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: softMap[s.tone], color: colorMap[s.tone],
              flexShrink: 0,
            }}><s.Icon size={14}/></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{s.label}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--ink)' }}>{s.val}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: colorMap[s.tone] }}>{s.trend}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Urgent Alerts Card ────────────────────────────────────────────────────────
function UrgentAlertsCard({
  urgentRequests, onAction,
}: {
  urgentRequests: CalendarDeparture[]
  onAction: (id: string, action: 'APPROVED' | 'REJECTED') => Promise<void>
}) {
  return (
    <div style={{
      padding: 'var(--card-pad)', display: 'flex', flexDirection: 'column',
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>דורש תשומת לב</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>בקשות חריגות</h3>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
          background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 11.5, fontWeight: 600,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>
          {urgentRequests.length} ממתינות
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {urgentRequests.slice(0, 3).map(r => (
          <div key={r.id} style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.55)', border: '1px solid var(--hairline)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Avatar name={r.student_name || '?'} size={32}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.student_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>· {r.class_id}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{r.reason}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button onClick={() => onAction(r.id, 'APPROVED')} style={{ flex: 1, padding: '6px 8px', background: 'var(--good-soft)', color: 'var(--good)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}>
                <CheckCircle2 size={13}/> אשר
              </button>
              <button onClick={() => onAction(r.id, 'REJECTED')} style={{ flex: 1, padding: '6px 8px', background: 'var(--bad-soft)', color: 'var(--bad)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: 'inherit' }}>
                <XCircle size={13}/> דחה
              </button>
            </div>
          </div>
        ))}
        {urgentRequests.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0', color: 'var(--ink-faint)' }}>
            <CheckCircle2 size={24}/>
            <span style={{ fontSize: 13 }}>אין בקשות חריגות</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Grade Breakdown Card ───────────────────────────────────────────────────────
function GradeBreakdownCard({ classStats }: { classStats: ClassStat[] }) {
  const gradeAgg = useMemo(() => {
    const grades = [...new Set(classStats.map(cs => cs.grade))].sort()
    return grades.map(g => {
      const cls = classStats.filter(cs => cs.grade === g)
      const total = cls.reduce((s, c) => s + c.total, 0)
      const onCampus = cls.reduce((s, c) => s + c.onCampus, 0)
      const offCampus = cls.reduce((s, c) => s + c.offCampus, 0)
      const pct = total > 0 ? Math.round((onCampus / total) * 100) : 0
      return { grade: g, total, onCampus, offCampus, pct }
    })
  }, [classStats])

  return (
    <div style={{
      padding: 'var(--card-pad)',
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>פילוח לפי שכבה</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>נוכחות מול היעדרות</h3>
        </div>
        <GraduationCap size={16} style={{ color: 'var(--ink-faint)' }}/>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {gradeAgg.map((g) => (
          <div key={g.grade}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{g.grade}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--good)' }}>● {g.onCampus} בישיבה</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--warn)' }}>● {g.offCampus} בחוץ</span>
              </div>
            </div>
            <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--hairline)' }}>
              <div style={{
                flex: g.onCampus || 1, background: 'linear-gradient(180deg, #34D399 0%, var(--good) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, color: 'white', fontWeight: 600,
                transition: 'flex 1s cubic-bezier(0.22,1,0.36,1)',
              }}>{g.pct}%</div>
              {g.offCampus > 0 && <div style={{
                flex: g.offCampus, background: 'rgba(234,88,12,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11.5, color: 'var(--warn)', fontWeight: 600,
              }}>{100 - g.pct}%</div>}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4 }}>סה"כ {g.total} תלמידים</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Today's Departures Gantt Mini ─────────────────────────────────────────────
function TodayDeparturesCard({ todayDepartures }: { todayDepartures: CalendarDeparture[] }) {
  return (
    <div style={{
      padding: 'var(--card-pad)',
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>היום ביציאות</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>תזמון יציאות</h3>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: 'var(--info-soft)', color: 'var(--info)', fontSize: 11.5, fontWeight: 600 }}>
          {todayDepartures.length} פעילות
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
        {todayDepartures.slice(0, 5).map(dep => {
          const start = new Date(dep.start_at)
          const end = new Date(dep.end_at)
          const startH = start.getHours() + start.getMinutes() / 60
          const endH = end.getHours() + end.getMinutes() / 60
          const totalRange = 16
          const startPct = Math.max(0, ((startH - 7) / totalRange) * 100)
          const widthPct = Math.max(2, ((endH - startH) / totalRange) * 100)
          const minsEnd = minsFromNow(dep.end_at)
          const isActive = minsFromNow(dep.start_at) <= 0 && minsEnd > 0
          const statusColor = isActive ? 'var(--warn)' : minsEnd > 0 ? 'var(--info)' : 'var(--plum)'
          return (
            <div key={dep.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{dep.student_name}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-muted)' }}>
                  {getTimeStr(dep.start_at)} – {getTimeStr(dep.end_at)}
                </span>
              </div>
              <div style={{ position: 'relative', height: 6, background: 'rgba(20,18,25,0.05)', borderRadius: 999 }}>
                <div style={{
                  position: 'absolute', insetInlineStart: `${startPct}%`, width: `${widthPct}%`,
                  top: 0, bottom: 0, background: statusColor, borderRadius: 999,
                }}/>
              </div>
            </div>
          )
        })}
        {todayDepartures.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>אין יציאות היום</div>
        )}
      </div>
    </div>
  )
}

// ── Class Stats Table ─────────────────────────────────────────────────────────
function ClassStatsTable({ classStats }: { classStats: ClassStat[] }) {
  const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'right', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-faint)', letterSpacing: '0.05em', textTransform: 'uppercase' }
  const td: React.CSSProperties = { padding: '12px 16px', textAlign: 'right' }
  const tdC: React.CSSProperties = { padding: '12px 16px', textAlign: 'center' }

  return (
    <div style={{
      overflow: 'hidden',
      background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)',
      WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--hairline)' }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>פירוט מלא</div>
          <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>נתוני כיתות</h3>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.6)', border: '1px solid var(--hairline)', color: 'var(--ink-muted)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            <Download size={13}/> ייצוא
          </button>
        </div>
      </div>

      <div className="admin-table-scroll"><table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr style={{ background: 'rgba(20,18,25,0.02)' }}>
            <th style={th}>שכבה / כיתה</th>
            <th style={{ ...th, textAlign: 'center' }}>סה"כ</th>
            <th style={{ ...th, textAlign: 'center' }}>בישיבה</th>
            <th style={{ ...th, textAlign: 'center' }}>מחוץ</th>
            <th style={{ ...th, textAlign: 'center' }}>היעדרות</th>
            <th style={{ ...th, textAlign: 'center' }}>מכסה</th>
          </tr>
        </thead>
        <tbody>
          {[...new Set(classStats.map((cs) => cs.grade))].sort().map((gradeName) => {
            const gradeClasses = classStats.filter((cs) => cs.grade === gradeName).sort((a, b) => a.classId.localeCompare(b.classId, 'he'))
            if (gradeClasses.length === 0) return null
            const gTotal = gradeClasses.reduce((s, cs) => s + cs.total, 0)
            const gOnCampus = gradeClasses.reduce((s, cs) => s + cs.onCampus, 0)
            const gOffCampus = gradeClasses.reduce((s, cs) => s + cs.offCampus, 0)
            const gAbsRate = gTotal > 0 ? (gOffCampus / gTotal) * 100 : 0
            const gradeQuota = gradeClasses.reduce((sum, cs) => sum + calcQuota(cs.total), 0)
            const gradeQuotaExceeded = gOffCampus >= gradeQuota
            const gHighAbs = gAbsRate > 20
            const multiClass = gradeClasses.length > 1
            return (
              <Fragment key={gradeName}>
                <tr style={{ borderTop: '1px solid var(--hairline)', background: 'rgba(20,18,25,0.025)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <GraduationCap size={14} style={{ display: 'inline-block', marginInlineEnd: 8, verticalAlign: 'middle', color: 'var(--ink-muted)' }}/>
                    {gradeName}
                    {gHighAbs && <span style={{ marginInlineStart: 8, fontSize: 10.5, padding: '1px 6px', borderRadius: 999, background: 'var(--bad-soft)', color: 'var(--bad)', fontWeight: 700 }}>⚠ {gAbsRate.toFixed(0)}%</span>}
                  </td>
                  <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace' }}>{gTotal}</td>
                  <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace', color: 'var(--good)', fontWeight: 600 }}>{gOnCampus}</td>
                  <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace', color: 'var(--warn)', fontWeight: 600 }}>{gOffCampus}</td>
                  <td style={tdC}><span style={{ fontWeight: 600, color: gHighAbs ? 'var(--bad)' : 'var(--ink-muted)' }}>{gAbsRate.toFixed(0)}%</span></td>
                  <td style={tdC}><span style={{ fontWeight: 600, color: gradeQuotaExceeded ? 'var(--bad)' : 'var(--ink-muted)' }}>{gOffCampus}/{gradeQuota}</span></td>
                </tr>
                {multiClass && gradeClasses.map((cs) => {
                  const absRate = cs.total > 0 ? (cs.offCampus / cs.total) * 100 : 0
                  const highAbs = absRate > 20
                  const classQuota = calcQuota(cs.total)
                  const classQuotaExceeded = cs.offCampus >= classQuota
                  return (
                    <tr key={cs.classId} style={{ borderTop: '1px solid var(--hairline)' }}>
                      <td style={{ ...td, paddingInlineStart: 44, color: 'var(--ink-muted)' }}>{cs.classId.split(' ').slice(-2).join(' ')}</td>
                      <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace' }}>{cs.total}</td>
                      <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace', color: 'var(--good)' }}>{cs.onCampus}</td>
                      <td style={{ ...tdC, fontFamily: 'JetBrains Mono, monospace', color: 'var(--warn)' }}>{cs.offCampus}</td>
                      <td style={tdC}><span style={{ fontWeight: 500, color: highAbs ? 'var(--bad)' : 'var(--ink-muted)' }}>{absRate.toFixed(0)}%</span></td>
                      <td style={tdC}><span style={{ fontWeight: 500, color: classQuotaExceeded ? 'var(--bad)' : 'var(--ink-muted)' }}>{cs.offCampus}/{classQuota}</span></td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table></div>
    </div>
  )
}

// ── Long Absent Alert ─────────────────────────────────────────────────────────
function LongAbsentCard({ students }: { students: Student[] }) {
  if (students.length === 0) return null
  return (
    <div style={{
      padding: 'var(--card-pad)', overflow: 'hidden',
      background: `linear-gradient(90deg, var(--bad-soft) 0%, transparent 40%), var(--glass-2)`,
      backdropFilter: 'blur(20px) saturate(140%)', WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
      borderInlineStart: '3px solid var(--bad)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bad-soft)', color: 'var(--bad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AlertTriangle size={18}/>
        </div>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--bad)' }}>דורש מעקב</div>
          <h3 style={{ marginTop: 2, fontSize: 16, fontWeight: 500 }}>לא נוכחים 7 ימים ומעלה</h3>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{students.length} תלמידים לא נרשמו כנוכחים מזה שבוע</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {students.slice(0, 8).map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.45)', border: '1px solid var(--hairline)' }}>
            <Avatar name={s.fullName} size={32}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.fullName}</div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--ink-faint)' }}>ת.ז. {s.idNumber}</div>
            </div>
            {s.phone && (
              <a href={`tel:${s.phone}`} style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)', color: 'var(--accent-deep)', fontSize: 12.5, fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Phone size={13}/> <span className="admin-phone-num">{s.phone}</span>
              </a>
            )}
          </div>
        ))}
        {students.length > 8 && <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-muted)', padding: '6px 0' }}>ועוד {students.length - 8} נוספים</div>}
      </div>
    </div>
  )
}

// ── Broadcast Card ────────────────────────────────────────────────────────────
function BroadcastCard({
  allStudents, broadcastTitle, setBroadcastTitle, broadcastBody, setBroadcastBody,
  broadcastTargetMode, setBroadcastMode, broadcastGrade, setBroadcastGrade,
  broadcastClass, setBroadcastClass, broadcastStudentId, setBroadcastStudentId,
  broadcastTargetIsReady, broadcastRegisteredCount, broadcastTargetStudents,
  broadcastTargetLabel, broadcastSending, broadcastResult, handleBroadcast,
  broadcastGrades, broadcastClasses, broadcastStudents,
}: any) {
  const modes = [
    { mode: 'all' as const, label: 'כולם', Icon: Users },
    { mode: 'grade' as const, label: 'שיעור', Icon: GraduationCap },
    { mode: 'class' as const, label: 'כיתה', Icon: School },
    { mode: 'student' as const, label: 'תלמיד', Icon: UserRound },
  ]

  return (
    <div style={{
      overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--accent-soft) 0%, transparent 40%), var(--glass-2)',
      backdropFilter: 'blur(20px) saturate(140%)', WebkitBackdropFilter: 'blur(20px) saturate(140%)',
      borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, var(--accent), #818CF8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: '0 6px 18px -4px rgba(79,70,229,0.4)', flexShrink: 0 }}>
            <Bell size={20}/>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-deep)' }}>שליחת התראה</div>
            <h3 style={{ marginTop: 4, fontSize: 17, fontWeight: 500 }}>פרסם הודעה לתלמידים</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>בחר יעד, כתוב הודעה ושלח למכשירים הרשומים בלבד</p>
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent-deep)', fontSize: 11.5, fontWeight: 600 }}>
          {allStudents.filter((s: Student) => Boolean(s.push_token)).length} מכשירים פעילים
        </span>
      </div>

      <form onSubmit={handleBroadcast} className="admin-broadcast-form">
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 10 }}>1. בחר יעד</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {modes.map(({ mode, label, Icon }) => {
              const active = broadcastTargetMode === mode
              return (
                <button key={mode} type="button" onClick={() => setBroadcastMode(mode)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderRadius: 12, background: active ? 'var(--ink)' : 'rgba(255,255,255,0.6)', color: active ? 'white' : 'var(--ink)', border: '1px solid ' + (active ? 'var(--ink)' : 'var(--hairline)'), cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', transition: 'all 0.18s' }}>
                  <Icon size={14}/><span>{label}</span>
                </button>
              )
            })}
          </div>

          {broadcastTargetMode !== 'all' && (
            <div style={{ marginTop: 14, padding: 14, background: 'rgba(255,255,255,0.5)', borderRadius: 12, border: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 6 }}>שיעור</div>
                <select value={broadcastGrade} onChange={e => { setBroadcastGrade(e.target.value); setBroadcastClass(''); setBroadcastStudentId(''); }} style={{ width: '100%', padding: '8px 12px', background: 'white', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}>
                  <option value="">בחר שיעור</option>
                  {broadcastGrades.map((g: string) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              {(broadcastTargetMode === 'class' || broadcastTargetMode === 'student') && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 6 }}>כיתה</div>
                  <select value={broadcastClass} onChange={e => { setBroadcastClass(e.target.value); setBroadcastStudentId(''); }} disabled={!broadcastGrade} style={{ width: '100%', padding: '8px 12px', background: 'white', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', opacity: !broadcastGrade ? 0.5 : 1 }}>
                    <option value="">בחר כיתה</option>
                    {broadcastClasses.map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {broadcastTargetMode === 'student' && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 6 }}>תלמיד</div>
                  <select value={broadcastStudentId} onChange={e => setBroadcastStudentId(e.target.value)} disabled={!broadcastGrade || !broadcastClass} style={{ width: '100%', padding: '8px 12px', background: 'white', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', opacity: (!broadcastGrade || !broadcastClass) ? 0.5 : 1 }}>
                    <option value="">בחר תלמיד</option>
                    {broadcastStudents.map((s: Student) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 10 }}>2. תוכן ההתראה</div>
          <input value={broadcastTitle} onChange={e => setBroadcastTitle(e.target.value)} placeholder="כותרת ההתראה" dir="rtl" style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)', borderRadius: 12, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', marginBottom: 8, textAlign: 'right', boxSizing: 'border-box' }}/>
          <textarea value={broadcastBody} onChange={e => setBroadcastBody(e.target.value)} placeholder="תוכן ההודעה..." rows={3} dir="rtl" style={{ width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.7)', border: '1px solid var(--hairline)', borderRadius: 12, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'none', textAlign: 'right', boxSizing: 'border-box' }}/>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', flex: 1 }}>
              {broadcastTargetIsReady ? `תועבר ל-${broadcastRegisteredCount} מכשירים פעילים` : 'בחר יעד'}
            </span>
            <button type="submit" disabled={broadcastSending || !broadcastTargetIsReady || broadcastRegisteredCount === 0 || (!broadcastTitle.trim() && !broadcastBody.trim())} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 999, background: 'linear-gradient(135deg, var(--accent), #818CF8)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit', opacity: (broadcastSending || !broadcastTargetIsReady || broadcastRegisteredCount === 0 || (!broadcastTitle.trim() && !broadcastBody.trim())) ? 0.4 : 1, boxShadow: '0 6px 18px -4px rgba(79,70,229,0.4)' }}>
              {broadcastSending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              {broadcastSending ? 'שולח...' : `שלח ל${broadcastTargetLabel}`}
            </button>
          </div>
          {broadcastResult && (
            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, textAlign: 'center', color: broadcastResult.sent > 0 ? 'var(--good)' : 'var(--bad)' }}>
              {broadcastResult.sent > 0 ? `✓ נשלח ל-${broadcastResult.sent} מכשירים${broadcastResult.failed > 0 ? ` · נכשל: ${broadcastResult.failed}` : ''}` : `שגיאה — השליחה נכשלה`}
            </div>
          )}
        </div>
      </form>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [longAbsentStudents, setLongAbsentStudents] = useState<Student[]>([])
  const [urgentRequests, setUrgentRequests] = useState<CalendarDeparture[]>([])
  const [classStats, setClassStats] = useState<ClassStat[]>([])
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [todayDepartures, setTodayDepartures] = useState<CalendarDeparture[]>([])
  const [, setTick] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [displayPct, setDisplayPct] = useState(0)
  const animFrameRef = useRef<number | null>(null)

  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastTargetMode, setBroadcastTargetMode] = useState<BroadcastTargetMode>('all')
  const [broadcastGrade, setBroadcastGrade] = useState('')
  const [broadcastClass, setBroadcastClass] = useState('')
  const [broadcastStudentId, setBroadcastStudentId] = useState('')
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number; failed: number; lastError?: string } | null>(null)
  const broadcastResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadData = async (isBackground = false) => {
    if (!isBackground) setIsLoading(true)
    api.tickDepartures().catch(() => {})
    try {
      const [statsRes, absentRes, clsStatsRes, allStudentsRes, pendingDepsRes, activeDepsRes] =
        await Promise.allSettled([
          api.getDashboardStats(),
          api.getLongAbsentStudents(7),
          api.getClassStats(),
          api.getStudents(),
          api.listDepartures({ status: 'PENDING' }),
          api.listDepartures({ status: ['ACTIVE', 'APPROVED'] }),
        ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value)
      if (absentRes.status === 'fulfilled') setLongAbsentStudents(absentRes.value)
      if (clsStatsRes.status === 'fulfilled') setClassStats(clsStatsRes.value)
      if (allStudentsRes.status === 'fulfilled') setAllStudents(allStudentsRes.value as Student[])
      if (pendingDepsRes.status === 'fulfilled') setUrgentRequests(pendingDepsRes.value.filter((d) => d.is_urgent))
      if (activeDepsRes.status === 'fulfilled') {
        const todayStr = new Date().toISOString().slice(0, 10)
        const todayDeps = activeDepsRes.value.filter((d) => {
          const depDate = new Date(d.start_at).toISOString().slice(0, 10)
          return depDate === todayStr && minsFromNow(d.end_at) > -60
        })
        todayDeps.sort((a, b) => a.start_at.localeCompare(b.start_at))
        setTodayDepartures(todayDeps)
      }
    } finally {
      if (!isBackground) setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const studentsChannel = supabase.channel('dashboard-students-realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => loadData(true)).subscribe()
    const tickInterval = setInterval(() => setTick((t) => t + 1), 60000)
    return () => { supabase.removeChannel(studentsChannel); clearInterval(tickInterval) }
  }, [])

  useDeparturesRealtime({ onAnyChange: () => loadData(true) })

  const handleUrgent = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    if (action === 'APPROVED') await api.approveDeparture(id, 'admin', 'ADMIN')
    else await api.rejectDeparture(id, 'admin', 'ADMIN')
  }

  const broadcastGrades = uniqueSorted(allStudents.map((s) => s.grade))
  const broadcastClasses = uniqueSorted(allStudents.filter((s) => !broadcastGrade || s.grade === broadcastGrade).map((s) => s.classId))
  const broadcastStudents = allStudents.filter((s) => (!broadcastGrade || s.grade === broadcastGrade) && (!broadcastClass || s.classId === broadcastClass)).sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))
  const broadcastTargetStudents = getBroadcastTargetStudents(allStudents, broadcastTargetMode, broadcastGrade, broadcastClass, broadcastStudentId)
  const broadcastRegisteredCount = broadcastTargetStudents.filter((s) => Boolean(s.push_token)).length
  const broadcastTargetIsReady = broadcastTargetMode === 'all' || (broadcastTargetMode === 'grade' && Boolean(broadcastGrade)) || (broadcastTargetMode === 'class' && Boolean(broadcastGrade && broadcastClass)) || (broadcastTargetMode === 'student' && Boolean(broadcastGrade && broadcastClass && broadcastStudentId))
  const broadcastTargetLabel = broadcastTargetMode === 'all' ? 'כולם' : broadcastTargetMode === 'grade' ? broadcastGrade || 'שיעור' : broadcastTargetMode === 'class' ? broadcastClass || 'כיתה' : broadcastStudents.find((s) => s.id === broadcastStudentId)?.fullName || 'תלמיד'

  const setBroadcastMode = (mode: BroadcastTargetMode) => {
    setBroadcastTargetMode(mode); setBroadcastGrade(''); setBroadcastClass(''); setBroadcastStudentId(''); setBroadcastResult(null)
  }

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!broadcastTitle.trim() && !broadcastBody.trim()) || !broadcastTargetIsReady) return
    setBroadcastSending(true); setBroadcastResult(null)
    try {
      const target = getBroadcastTargetPayload(broadcastTargetMode, broadcastGrade, broadcastClass, broadcastStudentId)
      const result = await api.sendPushNotification(broadcastTitle.trim(), broadcastBody.trim(), target)
      setBroadcastResult(result); setBroadcastTitle(''); setBroadcastBody('')
      if (broadcastResultTimer.current) clearTimeout(broadcastResultTimer.current)
      broadcastResultTimer.current = setTimeout(() => setBroadcastResult(null), 6000)
    } finally { setBroadcastSending(false) }
  }

  const onCampusPct = stats && stats.total > 0 ? Math.round((stats.onCampus / stats.total) * 100) : 0

  useEffect(() => {
    if (isLoading) { setDisplayPct(0); return }
    const target = onCampusPct; const duration = 2500; const startTime = performance.now()
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const tick = (now: number) => {
      const elapsed = now - startTime; const progress = Math.min(elapsed / duration, 1)
      setDisplayPct(Math.round(easeOutCubic(progress) * target))
      if (progress < 1) animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => { if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current) }
  }, [isLoading, onCampusPct])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
            סקירה כללית · {new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', margin: 0 }}>
            לוח הבקרה
          </h1>
          <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5, maxWidth: 540 }}>
            תמונה רגעית של נוכחות התלמידים בישיבה, חריגות פעילות וכל הפעולות המתפרסמות.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isLoading && stats && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 999, background: 'var(--good-soft)', color: 'var(--good)', fontSize: 12.5, fontWeight: 600, border: '1px solid rgba(22,163,74,0.2)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}/>
              המערכת מסונכרנת
            </span>
          )}
          <button onClick={() => loadData()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 999, background: 'rgba(255,255,255,0.7)', color: 'var(--ink)', border: '1px solid var(--hairline)', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit', backdropFilter: 'blur(10px)' }}>
            <RefreshCw size={14}/> רענן
          </button>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 999, background: 'var(--ink)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit', boxShadow: '0 4px 14px -4px rgba(20,18,25,0.3)' }}>
            <Download size={14}/> ייצוא דוח יום
          </button>
        </div>
      </div>

      {/* Hero Bento Row */}
      <div className="admin-hero-grid">
        <HeroPresence displayPct={displayPct} onCampusPct={onCampusPct} stats={stats} classStats={classStats}/>
        <LocationDial stats={stats}/>
        <QuickStats urgentRequests={urgentRequests} longAbsentStudents={longAbsentStudents} allStudents={allStudents} todayDepartures={todayDepartures}/>
      </div>

      {/* Presence Timeline + Urgent Alerts */}
      <div className="admin-split-grid">
        {/* Presence Timeline */}
        <div style={{ background: 'var(--glass-2)', backdropFilter: 'blur(20px) saturate(140%)', WebkitBackdropFilter: 'blur(20px) saturate(140%)', borderRadius: 'var(--radius)', border: '1px solid var(--hairline)', boxShadow: 'var(--shadow-card)', padding: 'var(--card-pad)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>מגמה</div>
              <h3 style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>נוכחות יומית · 4 ימים אחורה ו-4 קדימה</h3>
            </div>
          </div>
          <PresenceChart />
        </div>
        <UrgentAlertsCard urgentRequests={urgentRequests} onAction={handleUrgent}/>
      </div>

      {/* Grade Breakdown + Today Departures */}
      {classStats.length > 0 && (
        <div className="admin-split-grid">
          <GradeBreakdownCard classStats={classStats}/>
          <TodayDeparturesCard todayDepartures={todayDepartures}/>
        </div>
      )}

      {/* Class Stats Table */}
      {!isLoading && classStats.length > 0 && <ClassStatsTable classStats={classStats}/>}

      {/* Long Absent Alert */}
      <LongAbsentCard students={longAbsentStudents}/>

      {/* Broadcast */}
      <BroadcastCard
        allStudents={allStudents}
        broadcastTitle={broadcastTitle} setBroadcastTitle={setBroadcastTitle}
        broadcastBody={broadcastBody} setBroadcastBody={setBroadcastBody}
        broadcastTargetMode={broadcastTargetMode} setBroadcastMode={setBroadcastMode}
        broadcastGrade={broadcastGrade} setBroadcastGrade={setBroadcastGrade}
        broadcastClass={broadcastClass} setBroadcastClass={setBroadcastClass}
        broadcastStudentId={broadcastStudentId} setBroadcastStudentId={setBroadcastStudentId}
        broadcastTargetIsReady={broadcastTargetIsReady}
        broadcastRegisteredCount={broadcastRegisteredCount}
        broadcastTargetStudents={broadcastTargetStudents}
        broadcastTargetLabel={broadcastTargetLabel}
        broadcastSending={broadcastSending}
        broadcastResult={broadcastResult}
        handleBroadcast={handleBroadcast}
        broadcastGrades={broadcastGrades}
        broadcastClasses={broadcastClasses}
        broadcastStudents={broadcastStudents}
      />
    </div>
  )
}
