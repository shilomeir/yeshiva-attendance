import { useState } from 'react'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { useAuthStore } from '@/store/authStore'

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--hairline)',
  background: 'rgba(255,255,255,0.7)',
  color: 'var(--ink)',
  padding: '10px 14px',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
}

export function SettingsPage() {
  const { changeAdminPin } = useAuthStore()

  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPins, setShowPins] = useState(false)
  const [pinError, setPinError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault()
    setPinError('')

    if (newPin.length < 4) {
      setPinError('הסיסמה חייבת להכיל לפחות 4 תווים')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('הסיסמאות אינן תואמות')
      return
    }

    setSaving(true)
    const result = await changeAdminPin(oldPin, newPin)
    setSaving(false)

    if (!result.success) {
      const messages: Record<string, string> = {
        'invalid-current-pin': 'הסיסמה הנוכחית שגויה',
        'change-failed': 'הסיסמה לא שונתה בגלל שגיאת מערכת. נסה שוב.',
        'login-verification-failed': 'הסיסמה שונתה, אבל לא הצלחנו לאמת כניסה מחדש. יש להתנתק ולהיכנס שוב עם הסיסמה החדשה.',
      }
      setPinError(messages[result.error] ?? result.error)
      return
    }

    setOldPin('')
    setNewPin('')
    setConfirmPin('')
    toast({ title: 'הסיסמה שונתה בהצלחה' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)', maxWidth: 560 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-faint)', marginBottom: 6 }}>
          ניהול מערכת
        </div>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(34px, 3vw, 50px)', fontWeight: 500, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--ink)', margin: 0 }}>
          הגדרות
        </h1>
        <p style={{ marginTop: 8, color: 'var(--ink-muted)', fontSize: 14.5 }}>הגדרות מערכת וניהול סיסמה</p>
      </div>

      {/* PIN change card */}
      <div className="glass" style={{ padding: 'var(--card-pad)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--plum-soft)', color: 'var(--plum)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <KeyRound size={16} />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>שינוי סיסמת מנהל</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>שנה את קוד הגישה לפאנל הניהול</div>
          </div>
        </div>

        <form onSubmit={handleChangePin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input type="text" autoComplete="username" style={{ display: 'none' }} readOnly value="admin" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-muted)' }}>סיסמה נוכחית</label>
            <div style={{ position: 'relative' }}>
              <input
                id="oldPin"
                type={showPins ? 'text' : 'password'}
                value={oldPin}
                onChange={(e) => { setOldPin(e.target.value); setPinError('') }}
                placeholder="הזן סיסמה נוכחית"
                autoComplete="current-password"
                style={{ ...inputStyle, paddingInlineEnd: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPins(!showPins)}
                style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', display: 'flex' }}
              >
                {showPins ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-muted)' }}>סיסמה חדשה</label>
            <input
              id="newPin"
              type={showPins ? 'text' : 'password'}
              value={newPin}
              onChange={(e) => { setNewPin(e.target.value); setPinError('') }}
              placeholder="לפחות 4 תווים"
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-muted)' }}>אישור סיסמה חדשה</label>
            <input
              id="confirmPin"
              type={showPins ? 'text' : 'password'}
              value={confirmPin}
              onChange={(e) => { setConfirmPin(e.target.value); setPinError('') }}
              placeholder="הזן שוב את הסיסמה החדשה"
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>

          {pinError && (
            <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }} role="alert">{pinError}</p>
          )}

          <button
            type="submit"
            disabled={!oldPin || !newPin || !confirmPin || saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 10,
              background: 'linear-gradient(135deg, var(--ink), var(--accent))',
              border: 'none', cursor: !oldPin || !newPin || !confirmPin || saving ? 'not-allowed' : 'pointer',
              opacity: !oldPin || !newPin || !confirmPin || saving ? 0.5 : 1,
              color: '#fff', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
              alignSelf: 'flex-start',
              transition: 'opacity 0.15s',
            }}
          >
            <KeyRound size={14} />
            {saving ? 'שומר...' : 'שנה סיסמה'}
          </button>
        </form>
      </div>
    </div>
  )
}
