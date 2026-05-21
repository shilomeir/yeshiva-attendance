import { useEffect, useRef, useState } from 'react'

/**
 * Service-worker update prompt (master plan R-24 / R-54 / B-6).
 *
 * vite-plugin-pwa is configured with registerType: 'prompt'. This component
 * registers the SW manually so we can intercept the "new version waiting"
 * event and show the user a Hebrew prompt with a "רענן" button instead of
 * leaving them with stale chunks until they manually reload.
 *
 * Loaded via dynamic import so vite-plugin-pwa's virtual module doesn't
 * break dev-mode builds. Skipped entirely in dev (Vite serves modules
 * directly, no SW to update).
 */
export function PwaUpdateToast() {
  const [updateReady, setUpdateReady] = useState(false)
  // updateSWRef holds the callback returned by registerSW. Calling it with
  // `true` tells the waiting SW to take over and reloads the page.
  const updateSWRef = useRef<((reload?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    if (import.meta.env.DEV) return

    let mounted = true
    // Vite's virtual module — typed loosely because tsconfig doesn't include
    // the vite-plugin-pwa client types.
    import(/* @vite-ignore */ 'virtual:pwa-register')
      .then(({ registerSW }: { registerSW: (opts: {
        onNeedRefresh?: () => void
        onOfflineReady?: () => void
      }) => (reload?: boolean) => Promise<void> }) => {
        if (!mounted) return
        updateSWRef.current = registerSW({
          onNeedRefresh: () => { if (mounted) setUpdateReady(true) },
        })
      })
      .catch(() => { /* virtual module missing — SW prompt silently disabled */ })

    return () => { mounted = false }
  }, [])

  const handleReload = () => {
    if (updateSWRef.current) updateSWRef.current(true) // true → reload after activation
    else window.location.reload()
  }

  if (!updateReady) return null
  return (
    <div
      dir="rtl"
      className="fixed bottom-4 inset-x-4 sm:start-4 sm:end-auto sm:max-w-sm z-50 rounded-2xl border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30 p-3 shadow-lg flex items-center justify-between gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">גרסה חדשה זמינה</p>
        <p className="text-xs text-blue-700 dark:text-blue-400">רענן את הדף כדי להעמיס את הגרסה החדשה</p>
      </div>
      <button
        onClick={handleReload}
        className="shrink-0 rounded-xl bg-blue-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-600 transition-colors"
      >
        רענן
      </button>
      <button
        onClick={() => setUpdateReady(false)}
        aria-label="סגור"
        className="shrink-0 rounded-md p-1 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40"
      >
        ✕
      </button>
    </div>
  )
}
