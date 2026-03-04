import { AuditLogPanel } from '@/components/admin/AuditLogPanel'

export function AuditLogPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">לוג ביקורת</h2>
        <p className="text-sm text-[var(--text-muted)]">רשימת כל פעולות המנהל לפי סדר כרונולוגי הפוך</p>
      </div>
      <AuditLogPanel />
    </div>
  )
}
