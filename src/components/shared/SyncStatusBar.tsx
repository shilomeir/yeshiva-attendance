import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react'
import { useSyncStore } from '@/store/syncStore'
import { cn } from '@/lib/utils/cn'

export function SyncStatusBar() {
  const { isOnline, isSyncing, queueLength } = useSyncStore()

  if (isOnline && queueLength === 0 && !isSyncing) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-sm font-medium text-white',
        !isOnline ? 'bg-[var(--red)]' : isSyncing ? 'bg-[var(--orange)]' : 'bg-[var(--blue)]'
      )}
    >
      {!isOnline ? (
        <>
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>אין חיבור לאינטרנט — הנתונים יישמרו ויסונכרנו כשיחזור החיבור</span>
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>מסנכרן נתונים...</span>
        </>
      ) : (
        <>
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>{queueLength} פריטים ממתינים לסנכרון</span>
        </>
      )}
    </div>
  )
}
