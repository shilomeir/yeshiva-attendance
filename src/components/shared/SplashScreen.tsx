import { useEffect, useState } from 'react'

interface SplashScreenProps {
  onDone: () => void
}

/**
 * Animated splash screen with the Yeshiva logo.
 * Timeline:
 *   0ms  – logo bounces in (CSS keyframe, 900ms)
 *   2000ms – container starts fading out (500ms transition)
 *   2500ms – onDone() is called → splash unmounts
 */
export function SplashScreen({ onDone }: SplashScreenProps) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), 2000)
    const doneTimer = setTimeout(onDone, 2500)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(doneTimer)
    }
  }, [onDone])

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white"
      style={{
        transition: 'opacity 500ms ease',
        opacity: exiting ? 0 : 1,
        pointerEvents: exiting ? 'none' : 'auto',
      }}
    >
      {/* Logo with bounce-in animation */}
      <div style={{ animation: 'splashBounceIn 0.9s cubic-bezier(0.34,1.56,0.64,1) both' }}>
        <img
          src="/logo.png"
          alt="ישיבת שבי חברון"
          className="w-64 h-auto select-none"
          draggable={false}
        />
      </div>

      {/* Shimmer line under logo */}
      <div
        className="mt-6 h-0.5 rounded-full bg-gradient-to-r from-transparent via-[#3B82F6] to-transparent"
        style={{ width: 180, animation: 'splashShimmer 1.8s ease-in-out 0.5s infinite' }}
      />
    </div>
  )
}
