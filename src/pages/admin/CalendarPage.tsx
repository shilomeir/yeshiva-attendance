import { AbsenceCalendar } from '@/components/admin/AbsenceCalendar'

export function CalendarPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <h2 className="text-2xl font-bold text-[var(--text)]">לוח שנה</h2>
      <AbsenceCalendar />
    </div>
  )
}
