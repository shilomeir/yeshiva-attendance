import { useEffect, useState } from 'react'

interface SplashScreenProps {
  onDone: () => void
}

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
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: 'var(--parchment)',
        transition: 'opacity 500ms ease',
        opacity: exiting ? 0 : 1,
        pointerEvents: exiting ? 'none' : 'auto',
      }}
    >
      {/* Logo */}
      <div style={{ animation: 'splashBounceIn 0.9s cubic-bezier(0.34,1.56,0.64,1) both' }}>
        <img
          src="/logo.png"
          alt="ישיבת שבי חברון"
          className="w-64 h-auto select-none"
          draggable={false}
        />
      </div>

      {/* Indigo shimmer */}
      <div
        className="mt-6 h-0.5 rounded-full"
        style={{
          width: 180,
          background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
          animation: 'splashShimmer 1.8s ease-in-out 0.5s infinite',
        }}
      />
    </div>
  )
}
