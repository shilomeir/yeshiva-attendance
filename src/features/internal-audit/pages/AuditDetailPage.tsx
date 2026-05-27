import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Download, Clock, Users, AlertOctagon, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { auditApi } from '../api/auditApi'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import { deriveAuditStudentStatus, getAuditStatusDisplay } from '../domain/auditStatus'
import type {
  AuditSession,
  AuditParticipant,
  AuditLocationResponse,
  AuditManualMark,
  AuditAlert,
} from '../api/auditTypes'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} שניות`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}:${String(s).padStart(2, '0')} דקות`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')} שעות`
}

function toneColor(tone: ReturnType<typeof getAuditStatusDisplay>['tone']): string {
  switch (tone) {
    case 'good':    return 'var(--good)'
    case 'bad':     return 'var(--bad)'
    case 'warn':    return 'var(--warn)'
    case 'info':    return 'var(--info)'
    case 'neutral': return 'var(--ink-faint)'
  }
}

export function AuditDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [session, setSession] = useState<AuditSession | null>(null)
  const [participants, setParticipants] = useState<AuditParticipant[]>([])
  const [responses, setResponses] = useState<AuditLocationResponse[]>([])
  const [marks, setMarks] = useState<AuditManualMark[]>([])
  const [alerts, setAlerts] = useState<AuditAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!sessionId) return
    Promise.all([
      auditApi.getSession(sessionId),
      auditApi.getParticipants(sessionId),
      auditApi.getLocationResponses(sessionId),
      auditApi.getManualMarks(sessionId),
      auditApi.getAlerts(sessionId),
    ])
      .then(([s, p, r, m, a]) => {
        setSession(s); setParticipants(p); setResponses(r); setMarks(m); setAlerts(a)
      })
      .catch((err) => {
        toast({
          title: 'שגיאה בטעינת דוח',
          description: getErrorMessage(err, 'טעינת פרטי הביקורת נכשלה'),
          variant: 'destructive',
        })
      })
      .finally(() => setIsLoading(false))
  }, [sessionId])

  const responseByStudent = useMemo(() => new Map(responses.map((r) => [r.student_id, r])), [responses])
  const markByStudent     = useMemo(() => new Map(marks.map((m) => [m.student_id, m])),     [marks])

  const rows = useMemo(() => {
    return participants.map((p) => {
      const r = responseByStudent.get(p.student_id) ?? null
      const m = markByStudent.get(p.student_id) ?? null
      const derived = deriveAuditStudentStatus({
        expectedState: p.expected_state,
        locationStatus: r?.status ?? null,
        locationClass: r?.location_class ?? null,
        manualStatus: m?.status ?? null,
        hasApprovedDeparture: !!p.approved_departure_id,
      })
      return { participant: p, response: r, mark: m, derived }
    })
  }, [participants, responseByStudent, markByStudent])

  // Group by class
  const byClass = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const row of rows) {
      const arr = map.get(row.participant.class_id) ?? []
      arr.push(row)
      map.set(row.participant.class_id, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he'))
  }, [rows])

  // Timeline = all timestamped events in chronological order
  const timeline = useMemo(() => {
    type Item = { at: string; label: string; actor: string | null; severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'NEUTRAL' }
    const items: Item[] = []
    if (session?.started_at) items.push({ at: session.started_at, label: 'הופעלה ביקורת',  actor: session.started_by, severity: 'NEUTRAL' })
    for (const r of responses) {
      if (r.captured_at) {
        items.push({
          at: r.captured_at,
          label: `${nameOf(r.student_id, participants)}: ${responseLabel(r.status)}`,
          actor: null,
          severity: r.status === 'GRANTED' ? 'INFO' : r.status === 'LOW_ACCURACY' ? 'WARNING' : 'WARNING',
        })
      }
    }
    for (const m of marks) {
      items.push({
        at: m.updated_at,
        label: `${nameOf(m.student_id, participants)}: ${markLabel(m.status)}`,
        actor: m.marked_by,
        severity: m.status === 'OUTSIDE_UNAPPROVED' ? 'CRITICAL' : 'INFO',
      })
    }
    for (const a of alerts) {
      items.push({
        at: a.created_at,
        label: `חריגה: ${nameOf(a.student_id, participants)} — ${a.message}`,
        actor: null,
        severity: a.severity,
      })
    }
    if (session?.ended_at) items.push({ at: session.ended_at, label: 'נסגרה ביקורת', actor: null, severity: 'NEUTRAL' })
    return items.sort((a, b) => +new Date(a.at) - +new Date(b.at))
  }, [session, participants, responses, marks, alerts])

  const exportCsv = () => {
    if (!session) return
    const header = ['שם', 'ת.ז.', 'כיתה', 'שכבה', 'סטטוס נגזר', 'מקור', 'מצב מיקום', 'מרחק', 'דיוק', 'נלכד בשעה', 'סימון רכז', 'סומן ע״י', 'הערה']
    const lines = rows.map(({ participant, response, mark, derived }) => [
      participant.student_name,
      participant.id_number,
      participant.class_id,
      participant.grade,
      getAuditStatusDisplay(derived).label,
      response ? 'GPS' : mark ? `רכז (${mark.marked_by_role})` : participant.approved_departure_id ? 'יציאה מאושרת' : '—',
      response?.status ?? '',
      response?.distance_from_campus_meters ?? '',
      response?.accuracy_meters ? Math.round(response.accuracy_meters) : '',
      response?.captured_at ? new Date(response.captured_at).toLocaleString('he-IL') : '',
      mark?.status ?? '',
      mark?.marked_by ?? '',
      mark?.note ?? '',
    ])
    const csv = [header, ...lines].map((cols) => cols.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(session.title || 'audit').replace(/[^\p{L}\p{N}]+/gu, '-')}-${session.id.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-faint)' }}>טוען דוח...</div>
  }
  if (!session) {
    return <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-muted)' }}>הביקורת לא נמצאה.</div>
  }

  const summary = session.summary
  const duration = session.started_at && (session.ended_at || session.started_at)
    ? Math.floor(((session.ended_at ? +new Date(session.ended_at) : Date.now()) - +new Date(session.started_at)) / 1000)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6,
          }}>
            דוח ביקורת
          </div>
          <h1 style={{
            fontSize: 'clamp(28px, 2.4vw, 40px)', fontWeight: 500, lineHeight: 1,
            letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0,
          }}>
            {session.title}
          </h1>
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><Clock size={12} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} />{new Date(session.created_at).toLocaleString('he-IL')}</span>
            <span>· מי פתח: {session.started_by}</span>
            <span>· משך: {formatDuration(duration)}</span>
            <span>· מצב: {session.mode === 'LOCATION' ? 'עם מיקום' : 'ידנית'}</span>
            <span>· סטטוס: {session.status}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" asChild>
            <Link to="/admin/rollcall/history">
              <ChevronLeft size={14} />
              חזרה לרשימה
            </Link>
          </Button>
          <Button onClick={exportCsv}>
            <Download size={14} />
            ייצוא CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <SummaryCard label="משתתפים"          value={summary.totalParticipants}      icon={<Users size={16} />}        tone="var(--info)" />
          <SummaryCard label="כיתות"            value={summary.totalClasses}            icon={<MapPin size={16} />}       tone="var(--info)" />
          <SummaryCard label="נוכחים (מיקום)"   value={summary.onCampusByLocation}      tone="var(--good)" />
          <SummaryCard label="יציאה מאושרת"     value={summary.approvedOutside}         tone="var(--good)" />
          <SummaryCard label="מחוץ לטווח"       value={summary.outOfRange}              tone="var(--bad)"  icon={<AlertOctagon size={16} />} />
          <SummaryCard label="סומן: נוכח"       value={summary.manualPresent}           tone="var(--good)" />
          <SummaryCard label="סומן: בחוץ-אישור" value={summary.manualOutsideApproved}   tone="var(--info)" />
          <SummaryCard label="סומן: בחוץ ללא"   value={summary.manualOutsideUnapproved} tone="var(--bad)"  />
          <SummaryCard label="לא נענו"          value={summary.noResponse}              tone="var(--ink-faint)" />
          <SummaryCard label="חריגים קריטיים"   value={summary.criticalAlerts}          tone="var(--bad)"  />
          <SummaryCard label="אזהרות"           value={summary.warningAlerts}           tone="var(--warn)" />
        </div>
      )}

      {/* Per-class breakdown */}
      <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>פירוט לפי כיתות</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {byClass.map(([classId, classRows]) => (
            <ClassBlock key={classId} classId={classId} classRows={classRows} />
          ))}
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length > 0 && (
        <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>חריגים ({alerts.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {alerts.map((alert) => {
              const tone = alert.severity === 'CRITICAL' ? 'var(--bad)' : alert.severity === 'WARNING' ? 'var(--warn)' : 'var(--info)'
              return (
                <div key={alert.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
                  padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.55)', borderInlineStart: `3px solid ${tone}`,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {nameOf(alert.student_id, participants)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{alert.message}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {new Date(alert.created_at).toLocaleString('he-IL')}
                    {alert.resolved_at && ` · נסגר ע״י ${alert.resolved_by}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="glass" style={{ padding: 16, borderRadius: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>ציר זמן</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {timeline.map((item, i) => {
            const tone = item.severity === 'CRITICAL' ? 'var(--bad)'
                       : item.severity === 'WARNING'  ? 'var(--warn)'
                       : item.severity === 'INFO'     ? 'var(--info)'
                       : 'var(--ink-faint)'
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center',
                padding: '5px 10px', borderRadius: 7,
                background: 'rgba(255,255,255,0.45)',
                borderInlineStart: `2px solid ${tone}`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone }} />
                <span style={{ fontSize: 12, color: 'var(--ink)' }}>{item.label}{item.actor && ` (${item.actor})`}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {new Date(item.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label, value, tone, icon,
}: { label: string; value: number; tone: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'rgba(255,255,255,0.7)',
      border: '1px solid var(--hairline)',
      borderInlineStart: `3px solid ${tone}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{label}</div>
        {icon && <span style={{ color: tone }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

function ClassBlock({
  classId, classRows,
}: {
  classId: string
  classRows: Array<{ participant: AuditParticipant; response: AuditLocationResponse | null; mark: AuditManualMark | null; derived: ReturnType<typeof deriveAuditStudentStatus> }>
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
          {classId.replace(/^כיתה\s+/, '')}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{classRows.length} תלמידים</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {classRows.map(({ participant, response, mark, derived }) => {
          const display = getAuditStatusDisplay(derived)
          const color = toneColor(display.tone)
          return (
            <div key={participant.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1fr) auto',
              gap: 10, alignItems: 'center',
              padding: '5px 10px', borderRadius: 7,
              background: 'rgba(255,255,255,0.55)',
              borderInlineStart: `2px solid ${color}`,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {participant.student_name}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color }}>{display.label}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {response?.distance_from_campus_meters !== undefined && response?.distance_from_campus_meters !== null
                  ? <><span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{response.distance_from_campus_meters} מ׳</span></>
                  : mark
                    ? <>סומן ע״י {mark.marked_by}</>
                    : participant.approved_departure_label ?? '—'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'JetBrains Mono, monospace' }}>
                {response?.captured_at
                  ? new Date(response.captured_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                  : mark?.updated_at
                    ? new Date(mark.updated_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                    : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function nameOf(studentId: string, participants: AuditParticipant[]): string {
  return participants.find((p) => p.student_id === studentId)?.student_name ?? studentId
}

function responseLabel(status: string): string {
  switch (status) {
    case 'GRANTED':         return 'שלח מיקום'
    case 'LOW_ACCURACY':    return 'שלח מיקום (דיוק נמוך)'
    case 'DENIED_BY_USER':  return 'דחה הרשאת מיקום'
    case 'UNAVAILABLE':     return 'GPS לא זמין'
    case 'TIMEOUT':         return 'GPS timeout'
    case 'FAILED':          return 'מיקום נכשל'
    case 'APP_OPENED':      return 'פתח את האפליקציה'
    case 'REQUEST_SENT':    return 'התראה נשלחה'
    default:                return status
  }
}

function markLabel(status: string): string {
  switch (status) {
    case 'PRESENT':            return 'סומן נוכח'
    case 'OUTSIDE_APPROVED':   return 'סומן בחוץ עם אישור'
    case 'OUTSIDE_UNAPPROVED': return 'סומן בחוץ ללא אישור'
    default:                   return status
  }
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
