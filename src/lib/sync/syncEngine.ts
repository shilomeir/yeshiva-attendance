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

function notifyListeners(syncing: boolean, queueLength: number): void {
  for (const listener of listeners) {
    listener({ isSyncing: syncing, queueLength })
  }
}

/** Call after manually adding items to the sync queue to refresh the status bar. */
export async function notifyQueueChanged(): Promise<void> {
  const len = await getQueueLength()
  notifyListeners(isSyncing, len)
}

export async function processQueue(): Promise<void> {
  if (isSyncing) return
  if (!navigator.onLine) return

  const queueItems = await db.syncQueue.toArray()
  if (queueItems.length === 0) return

  isSyncing = true
  notifyListeners(true, queueItems.length)

  try {
    // Dynamic import to avoid circular dependency
    const { supabase } = await import('@/lib/supabase')

    for (const item of queueItems) {
      try {
        if (item.operation === 'RPC') {
          const { error } = await supabase.rpc(item.tableName, item.payload)
          if (error) throw error
        } else if (item.operation === 'INSERT') {
          const { error } = await supabase.from(item.tableName).insert(item.payload)
          if (error) throw error
        } else if (item.operation === 'UPDATE') {
          const { id, ...rest } = item.payload as { id: string } & Record<string, unknown>
          const { error } = await supabase.from(item.tableName).update(rest).eq('id', String(id))
          if (error) throw error
        }

        // Remove processed item from queue
        await db.syncQueue.delete(item.id)

        // Mark local event as synced when the event row was pushed
        if (item.tableName === 'events' && item.operation === 'INSERT') {
          const eventId = (item.payload as { id: string }).id
          await db.events.update(eventId, { syncedAt: new Date().toISOString() })
        }
      } catch (err) {
        console.error('[syncEngine] Failed to sync item', item.id, item.operation, item.tableName, err)
        await db.syncQueue.update(item.id, { retryCount: item.retryCount + 1 })
      }
    }
  } finally {
    isSyncing = false
    const remaining = await db.syncQueue.count()
    notifyListeners(false, remaining)
  }
}

export async function getQueueLength(): Promise<number> {
  return db.syncQueue.count()
}

export function initSync(): void {
  // Trigger 1: Back online
  window.addEventListener('online', () => {
    processQueue()
  })

  // Trigger 2: App comes back to foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      processQueue()
    }
  })

  // Initial attempt on app start
  processQueue()

  // Periodic sync every 30 seconds
  setInterval(() => {
    processQueue()
  }, 30000)
}
