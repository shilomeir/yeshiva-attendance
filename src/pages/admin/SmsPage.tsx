import { SmsWebhookPanel } from '@/components/admin/SmsWebhookPanel'

export function SmsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">ניהול SMS</h2>
        <p className="text-sm text-[var(--text-muted)]">
          פורמט SMS — יציאה: <code className="rounded bg-[var(--bg-2)] px-1 text-xs">יציאה HH:MM [סיבה]</code>
          &nbsp;|&nbsp; חזרה: <code className="rounded bg-[var(--bg-2)] px-1 text-xs">חזרה</code>
        </p>
      </div>
      <SmsWebhookPanel />
    </div>
  )
}
