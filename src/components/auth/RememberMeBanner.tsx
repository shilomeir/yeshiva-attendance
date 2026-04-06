import { useState } from 'react'
import { Bell, X } from 'lucide-react'

interface RememberMeBannerProps {
  onYes: () => Promise<void>
  onNo: () => void
}

export function RememberMeBanner({ onYes, onNo }: RememberMeBannerProps) {
  const [loading, setLoading] = useState(false)

  const handleYes = async () => {
    setLoading(true)
    try {
      await onYes()
    } finally {
      setLoading(false)
    }
  }

  return (
    /* Full-screen blur backdrop */
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Blur overlay */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onNo} />

      {/* Glassmorphism card sliding up from bottom */}
      <div
        className="relative z-10 w-full max-w-sm mx-4 mb-8 rounded-3xl border border-white/30 bg-white/20 p-6 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-black/30"
        style={{ animation: 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
      >
        {/* Dismiss X */}
        <button
          onClick={onNo}
          className="absolute left-4 top-4 rounded-full p-1.5 text-white/70 hover:text-white transition-colors"
          aria-label="סגור"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon */}
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/30 shadow-inner backdrop-blur-md">
            <Bell className="h-8 w-8 text-white drop-shadow" />
          </div>
        </div>

        {/* Text */}
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-white drop-shadow">זכור אותי</h2>
          <p className="mt-1.5 text-sm text-white/80 leading-relaxed">
            כדי שלא תצטרך להקליד את המספר שלך בכל כניסה, ולקבל התראה כשהבקשה שלך מאושרת
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleYes}
            disabled={loading}
            className="w-full rounded-2xl bg-white py-3.5 text-sm font-bold text-blue-600 shadow-lg transition-all active:scale-95 disabled:opacity-60"
          >
            {loading ? 'מגדיר...' : 'כן, זכור אותי! 🔔'}
          </button>
          <button
            onClick={onNo}
            disabled={loading}
            className="w-full rounded-2xl border border-white/30 py-3 text-sm font-medium text-white/80 transition-all hover:text-white active:scale-95"
          >
            לא תודה
          </button>
        </div>
      </div>

      {/* Slide-up keyframe injected inline */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
