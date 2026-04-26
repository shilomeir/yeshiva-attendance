import { create } from 'zustand'
import { addSyncListener, getQueueLength, processQueue } from '@/lib/sync/syncEngine'

interface SyncState {
  isOnline: boolean
  isSyncing: boolean
  queueLength: number
  failedCount: number
  lastSyncAt: string | null

  initialize: () => () => void
  triggerSync: () => void
}

export const useSyncStore = create<SyncState>()((set) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  queueLength: 0,
  failedCount: 0,
  lastSyncAt: null,

  initialize: () => {
    // Listen to online/offline
    const handleOnline = () => set({ isOnline: true })
    const handleOffline = () => set({ isOnline: false })

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Listen to sync state
    const removeSyncListener = addSyncListener(({ isSyncing, queueLength, failedCount }) => {
      set({
        isSyncing,
        queueLength,
        failedCount,
        ...(!isSyncing ? { lastSyncAt: new Date().toISOString() } : {}),
      })
    })

    // Get initial queue length
    getQueueLength().then((len) => set({ queueLength: len }))

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      removeSyncListener()
    }
  },

  triggerSync: () => {
    processQueue()
  },
}))
