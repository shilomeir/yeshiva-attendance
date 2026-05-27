import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { auditApi } from '../api/auditApi'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { AuditHistoryRow } from '../api/auditTypes'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} שניות`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}:${String(s).padStart(2, '0')} דקות`
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')} שעות`
}

export function AuditHistoryPage() {
  const [rows, setRows] = useState<AuditHistoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    auditApi
      .getHistory()
      .then(setRows)
      .catch((err) => {
        toast({
          title: 'שגיאה בטעינת היסטוריה',
          description: getErrorMessage(err, 'טעינת ביקורות קודמות נכשלה'),
          variant: 'destructive',
        })
      })
      .finally(() => setIsLoading(false))
  }, [])

  const exportCsv = () => {
    const header = [
      'תאריך', 'שעה', 'כותרת', 'מצב', 'סטטוס',
      'משך', 'תלמידים', 'כיתות', 'נוכחים', 'יציאה מאושרת',
      'חריגים', 'דורש רכז', 'לא נענו',
    ]
    const lines = rows.map((r) => {
      const d = new Date(r.created_at)
      const s = r.summary
      return [
        d.toLocaleDateString('he-IL'),
        d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        r.title,
        r.mode === 'LOCATION' ? 'עם מיקום' : 'ידנית',
        r.status,
        formatDuration(r.duration_seconds),
        r.participants_count,
        r.classes_count,
        s?.onCampusByLocation ?? '',
        s?.approvedOutside ?? '',
        s?.outOfRange ?? r.critical_count,
        s?.manualOutsideUnapproved ?? '',
        s?.noResponse ?? '',
      ]
    })
    const csv = [header, ...lines].map((cols) => cols.map(escapeCsv).join(',')).join('\n')
    // UTF-8 BOM so Excel opens Hebrew correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ביקורות-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6,
          }}>
            ארכיון
          </div>
          <h1 style={{
            fontSize: 'clamp(28px, 2.4vw, 40px)', fontWeight: 500, lineHeight: 1,
            letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0,
          }}>
            ביקורות קודמות
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" asChild>
            <Link to="/admin/rollcall">
              <ChevronLeft size={14} />
              חזרה לביקורת
            </Link>
          </Button>
          <Button onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={14} />
            ייצוא CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 36, textAlign: 'center', color: 'var(--ink-faint)' }}>טוען...</div>
      ) : rows.length === 0 ? (
        <div className="glass" style={{ padding: 36, textAlign: 'center', borderRadius: 14, color: 'var(--ink-muted)' }}>
          אין עדיין ביקורות שמורות.
        </div>
      ) : (
        <div className="glass" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              display: 'grid', gap: 12, alignItems: 'center',
              gridTemplateColumns: 'minmax(0, 2fr) repeat(5, minmax(0, 1fr)) auto',
              padding: '12px 16px',
              borderBottom: '1px solid var(--hairline)',
              borderInlineStart: `3px solid ${r.critical_count > 0 ? 'var(--bad)' : 'var(--good)'}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {new Date(r.created_at).toLocaleString('he-IL')} · {r.started_by}
                </div>
              </div>
              <Field label="מצב"      value={r.mode === 'LOCATION' ? 'עם מיקום' : 'ידנית'} />
              <Field label="סטטוס"    value={STATUS_LABEL[r.status] ?? r.status} />
              <Field label="משך"      value={formatDuration(r.duration_seconds)} />
              <Field label="תלמידים"  value={String(r.participants_count)} />
              <Field label="חריגים"   value={String(r.critical_count)} tone={r.critical_count > 0 ? 'var(--bad)' : undefined} />
              <div />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: 'הסתיים',
  ACTIVE:    'פעיל',
  CANCELLED: 'בוטל',
  DRAFT:     'טיוטה',
  CLOSING:   'בסיום',
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: tone ?? 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
