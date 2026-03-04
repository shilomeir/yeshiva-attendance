import { db } from '@/lib/db/schema'

let isSyncing = false

export type SyncListener = (state: { isSyncing: boolean; queueLength: number }) => void
const listeners: SyncListener[] = []

export function addSyncListener(listener: SyncListener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx > -1) listeners.splice(idx, 1)
  }
}

function notifyListeners(isSyncing: boolean, queueLength: number): void {
  for (const listener of listeners) {
    listener({ isSyncing, queueLength })
  }
}

export async function processQueue(): Promise<void> {
  if (isSyncing) return
  if (!navigator.onLine) return

  const queueItems = await db.syncQueue.toArray()
  if (queueItems.length === 0) return

  isSyncing = true
  notifyListeners(true, queueItems.length)

  try {
    // Simulate processing each item
    for (const item of queueItems) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Mark as synced based on table
      if (item.tableName === 'events') {
        const payload = item.payload as { id: string; syncedAt: string | null }
        if (payload.id) {
          await db.events.update(payload.id, {
            syncedAt: new Date().toISOString(),
          })
        }
      }

      // Remove from queue
      await db.syncQueue.delete(item.id)
    }

    notifyListeners(false, 0)
    console.log(`[SyncEngine] Synced ${queueItems.length} items`)
  } catch (error) {
    console.error('[SyncEngine] Sync failed:', error)

    // Increment retry counts
    for (const item of queueItems) {
      await db.syncQueue.update(item.id, {
        retryCount: item.retryCount + 1,
      })
    }

    const remaining = await db.syncQueue.count()
    notifyListeners(false, remaining)
  } finally {
    isSyncing = false
  }
}

export async function getQueueLength(): Promise<number> {
  return db.syncQueue.count()
}

export function initSync(): void {
  // Trigger 1: Online event
  window.addEventListener('online', () => {
    console.log('[SyncEngine] Back online, processing queue')
    processQueue()
  })

  // Trigger 2: Visibility change (app comes back to foreground)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[SyncEngine] App visible, processing queue')
      processQueue()
    }
  })

  // Initial sync attempt on app start
  processQueue()

  // Periodic sync every 30 seconds
  setInterval(() => {
    processQueue()
  }, 30000)
}
