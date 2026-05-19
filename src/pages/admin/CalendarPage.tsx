import { AbsenceCalendar } from '@/components/admin/AbsenceCalendar'

export function CalendarPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
          תיאום זמנים
        </div>
        <h1 style={{ fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', fontFamily: 'Fraunces, serif', margin: 0 }}>
          לוח שנה
        </h1>
        <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5 }}>
          תצוגת היעדרויות, יציאות מאושרות וחג״מים, מקובצת לפי יום.
        </p>
      </div>
      <AbsenceCalendar />
    </div>
  )
}
