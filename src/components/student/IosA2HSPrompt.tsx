import { useEffect, useState } from 'react'
import { X, Share } from 'lucide-react'

const DISMISSED_KEY = 'yeshiva_ios_a2hs_dismissed_v1'

/**
 * Master plan R-53: iOS-only "Add to Home Screen" onboarding.
 *
 * iOS Safari does NOT show Web Push notifications unless the PWA has been
 * installed via "Share → Add to Home Screen". Without this, the audit-mode
 * LOCATION push never reaches iPhone students. Android/Chrome have a
 * native install prompt; iOS doesn't, so we have to surface the steps.
 *
 * Shown once. Dismissal is persisted in localStorage so it doesn't nag.
 * Already-installed PWAs (running in standalone display mode) skip the
 * banner entirely.
 */
export function IosA2HSPrompt() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(DISMISSED_KEY)) return

    const ua = navigator.userAgent
    const isIPhone = /iPhone|iPad|iPod/i.test(ua)
    if (!isIPhone) return

    // Already installed as a home-screen PWA — Safari runs in standalone mode.
    const inStandalone =
      'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true
    if (inStandalone) return

    setShow(true)
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setShow(false)
  }

  if (!show) return null
  return (
    <div
      dir="rtl"
      className="mx-4 mt-3 rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 p-3 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
          להתראות בזמן ביקורת
        </p>
        <button
          onClick={handleDismiss}
          aria-label="סגור"
          className="rounded-md p-1 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
        הוסף את האפליקציה למסך הבית כדי לקבל התראות בזמן ביקורת.
        <br />
        בסאפארי: לחץ על <Share className="inline h-3.5 w-3.5 mx-1" />
        ואז בחר <span className="font-semibold">"הוסף למסך הבית"</span>.
      </p>
    </div>
  )
}
