import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { OffCampusSheet } from '@/components/student/OffCampusSheet'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errors'
import type { StudentStatus } from '@/types'

interface StatusButtonsProps {
  currentStatus: StudentStatus
  onStatusChange: (newStatus: StudentStatus) => void
  onCheckoutSuccess?: (departureId: string) => void
}

export function StatusButtons({ currentStatus, onStatusChange, onCheckoutSuccess }: StatusButtonsProps) {
  const { currentUser } = useAuthStore()
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [showOffCampusSheet, setShowOffCampusSheet] = useState(false)

  const isOnCampus = currentStatus === 'ON_CAMPUS'
  const isOffCampus = currentStatus === 'OFF_CAMPUS' || currentStatus === 'OVERDUE'

  const handleCheckIn = async () => {
    if (!currentUser || isCheckingIn) return
    setIsCheckingIn(true)

    try {
      const activeDeps = await api.listDepartures({
        studentId: currentUser.id,
        status: 'ACTIVE',
      })

      if (activeDeps.length > 0) {
        const confirmed = window.confirm('יש לך יציאה פתוחה. האם לרשום חזרה ולסגור אותה?')
        if (!confirmed) {
          setIsCheckingIn(false)
          return
        }
        await api.returnDeparture(activeDeps[0].id, currentUser.id)
      } else {
        await api.createEvent({
          studentId: currentUser.id,
          type: 'CHECK_IN',
          gpsLat: null,
          gpsLng: null,
          gpsStatus: 'PENDING',
          distanceFromCampus: null,
        })
        await api.updateStudentStatus(currentUser.id, 'ON_CAMPUS')
      }

      onStatusChange('ON_CAMPUS')
      toast({ title: 'ברוך שובך!', description: 'החזרה לישיבה נרשמה בהצלחה' })
    } catch (err) {
      toast({ title: 'שגיאה ברישום החזרה', description: getErrorMessage(err, 'רישום החזרה לישיבה נכשל'), variant: 'destructive' })
    } finally {
      setIsCheckingIn(false)
    }
  }

  return (
    <>
      <div
        className="flex flex-col items-center"
        style={{ paddingTop: 24, paddingBottom: 8, gap: 20 }}
        dir="rtl"
      >
        {/* ── Hero orb ── */}
        <div style={{ position: 'relative', width: 220, height: 220 }}>

          {/* LIVE pill — top-right when present */}
          {isOnCampus && (
            <div
              className="live-pill"
              style={{
                position: 'absolute', top: 4, right: 16, zIndex: 10,
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 8px 3px 7px',
                borderRadius: 999,
                fontFamily: 'Heebo, system-ui, sans-serif',
                fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                color: '#15803d',
              }}
            >
              <span
                className="pulse-dot"
                style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e, 0 0 0 3px rgba(34,197,94,0.18)',
                  display: 'inline-block', flexShrink: 0,
                }}
              />
              <span>LIVE</span>
            </div>
          )}

          {/* Orb button */}
          <button
            onClick={isOffCampus ? handleCheckIn : undefined}
            disabled={isCheckingIn}
            className={isOnCampus ? 'orb-breathe' : ''}
            style={{
              position: 'absolute', top: 18, left: 18,
              width: 184, height: 184,
              borderRadius: '50%',
              border: 'none',
              background: isOnCampus
                ? 'linear-gradient(160deg, #4ade80 0%, #34c759 50%, #22a04a 100%)'
                : 'linear-gradient(160deg, #94a3b8 0%, #64748b 60%, #475569 100%)',
              boxShadow: isOnCampus
                ? '0 16px 32px -10px rgba(52,199,89,0.45), inset 0 -4px 12px rgba(20,120,55,0.32), inset 0 3px 10px rgba(255,255,255,0.28), 0 0 0 6px rgba(255,255,255,0.55), 0 0 0 7px rgba(15,23,42,0.04)'
                : '0 16px 32px -10px rgba(100,116,139,0.38), inset 0 -4px 12px rgba(50,60,80,0.2), inset 0 3px 10px rgba(255,255,255,0.15), 0 0 0 6px rgba(255,255,255,0.45)',
              display: 'grid', placeItems: 'center',
              cursor: isOffCampus && !isCheckingIn ? 'pointer' : 'default',
              overflow: 'hidden',
              transition: 'transform 0.15s ease, opacity 0.15s ease',
            }}
          >
            {/* Specular crescent highlight */}
            <div style={{
              position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
              width: 120, height: 40, borderRadius: '50%',
              background: 'radial-gradient(ellipse, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 70%)',
              filter: 'blur(2px)', pointerEvents: 'none',
            }} />
            {/* Bottom depth rim */}
            <div style={{
              position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
              width: 130, height: 26, borderRadius: '50%',
              background: 'radial-gradient(ellipse, rgba(167,243,189,0.3) 0%, rgba(167,243,189,0) 70%)',
              filter: 'blur(4px)', pointerEvents: 'none',
            }} />

            {/* Icon */}
            {isCheckingIn ? (
              <Loader2
                className="animate-spin"
                style={{ width: 52, height: 52, color: 'white', position: 'relative', zIndex: 2 }}
              />
            ) : isOnCampus ? (
              /* Check-mark when on campus */
              <svg width="78" height="78" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 2px 6px rgba(20,80,40,0.35))', position: 'relative', zIndex: 2 }}>
                <path d="M5 12.5 L10.5 18 L19 7" />
              </svg>
            ) : (
              /* Return arrow when off campus */
              <svg width="68" height="68" viewBox="0 0 24 24" fill="none"
                stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))', position: 'relative', zIndex: 2 }}>
                <path d="M9 10l-5 5 5 5" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
            )}
          </button>
        </div>

        {/* ── Status greeting ── */}
        <div style={{ textAlign: 'center', padding: '0 16px' }}>
          <h2 style={{
            fontSize: 24, fontWeight: 800, color: 'var(--text)',
            marginBottom: 8, letterSpacing: -0.3, lineHeight: 1.2,
          }}>
            {isOnCampus ? 'ברוך הבא לישיבה' : 'מחוץ לישיבה'}
          </h2>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: isOnCampus ? 'rgba(16,185,129,0.12)' : 'rgba(249,115,22,0.12)',
            border: `1px solid ${isOnCampus ? 'rgba(16,185,129,0.25)' : 'rgba(249,115,22,0.25)'}`,
          }}>
            <span
              className="pulse-dot"
              style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isOnCampus ? '#10b981' : '#f97316',
                boxShadow: `0 0 8px ${isOnCampus ? '#10b981' : '#f97316'}`,
              }}
            />
            <span style={{
              color: isOnCampus ? '#059669' : '#ea580c',
              fontSize: 12, fontWeight: 700,
            }}>
              {isOnCampus ? 'סטטוס: נוכח' : 'סטטוס: בחוץ'}
            </span>
          </div>
        </div>

        {/* ── CTA bar ── */}
        <div style={{ width: '100%', padding: '0 16px' }}>
          {isOnCampus ? (
            <button
              onClick={() => setShowOffCampusSheet(true)}
              className="student-cta-bar"
              style={{
                width: '100%', height: 72,
                borderRadius: 28,
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
                display: 'block',
              }}
            >
              {/* Text area */}
              <div style={{
                position: 'absolute', inset: '0 80px 0 16px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                textAlign: 'right',
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2, color: 'var(--text)' }}>
                  לחץ לרישום יציאה
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                  מחוץ לישיבה
                </div>
              </div>
              {/* Orange handle */}
              <div style={{
                position: 'absolute', top: 6, left: 6, width: 60, height: 60,
                borderRadius: 22,
                background: 'linear-gradient(160deg, #fb923c 0%, #ea580c 100%)',
                boxShadow: '0 10px 24px -6px rgba(234,88,12,0.55), inset 0 1px 0 rgba(255,255,255,0.4)',
                display: 'grid', placeItems: 'center', color: '#fff',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 6l-6 6 6 6" />
                </svg>
              </div>
            </button>
          ) : (
            <button
              onClick={handleCheckIn}
              disabled={isCheckingIn}
              className="student-cta-bar"
              style={{
                width: '100%', height: 72,
                borderRadius: 28,
                position: 'relative',
                overflow: 'hidden',
                cursor: isCheckingIn ? 'default' : 'pointer',
                opacity: isCheckingIn ? 0.7 : 1,
                display: 'block',
              }}
            >
              {/* Text area */}
              <div style={{
                position: 'absolute', inset: '0 80px 0 16px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                textAlign: 'right',
              }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2, color: 'var(--text)' }}>
                  לחץ לרישום חזרה
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                  חזרה לישיבה
                </div>
              </div>
              {/* Green handle */}
              <div style={{
                position: 'absolute', top: 6, left: 6, width: 60, height: 60,
                borderRadius: 22,
                background: 'linear-gradient(160deg, #4ade80 0%, #22a04a 100%)',
                boxShadow: '0 10px 24px -6px rgba(34,197,94,0.55), inset 0 1px 0 rgba(255,255,255,0.4)',
                display: 'grid', placeItems: 'center', color: '#fff',
              }}>
                {isCheckingIn ? (
                  <Loader2 className="animate-spin" style={{ width: 22, height: 22 }} />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 18l6-6-6-6" />
                  </svg>
                )}
              </div>
            </button>
          )}
        </div>
      </div>

      <OffCampusSheet
        open={showOffCampusSheet}
        onClose={() => setShowOffCampusSheet(false)}
        onSuccess={(departureId) => {
          onStatusChange('OFF_CAMPUS')
          onCheckoutSuccess?.(departureId)
        }}
      />
    </>
  )
}
