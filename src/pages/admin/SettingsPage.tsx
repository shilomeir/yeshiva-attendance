import { useState } from 'react'
import { Save, KeyRound, Clock, Eye, EyeOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { useAuthStore } from '@/store/authStore'

const SETTINGS_KEY = 'yeshiva_settings'

interface Settings {
  gracePeriodMinutes: number
}

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { gracePeriodMinutes: 30 }
}

export function SettingsPage() {
  const { changeAdminPin } = useAuthStore()
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [isDirty, setIsDirty] = useState(false)

  // PIN change state
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPins, setShowPins] = useState(false)
  const [pinError, setPinError] = useState('')

  const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    setIsDirty(false)
    toast({ title: 'ההגדרות נשמרו בהצלחה' })
  }

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

    const success = await changeAdminPin(oldPin, newPin)
    if (!success) {
      setPinError('הסיסמה הנוכחית שגויה')
      return
    }

    setOldPin('')
    setNewPin('')
    setConfirmPin('')
    toast({ title: 'הסיסמה שונתה בהצלחה' })
  }

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text)]">הגדרות</h2>
        <p className="text-sm text-[var(--text-muted)]">הגדרות מערכת וניהול סיסמה</p>
      </div>

      {/* Grace period */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-[var(--blue)]" />
            זמן חסד
          </CardTitle>
          <CardDescription>דקות לאחר שעת החזרה לפני סיווג כ"באיחור"</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              id="grace"
              type="number"
              min={0}
              max={120}
              value={settings.gracePeriodMinutes}
              onChange={(e) => {
                setSettings({ gracePeriodMinutes: Number(e.target.value) })
                setIsDirty(true)
              }}
              className="w-24 text-center"
            />
            <span className="text-sm text-[var(--text-muted)]">דקות</span>
          </div>
          <Button onClick={saveSettings} disabled={!isDirty} className="mt-4" size="sm">
            <Save className="h-4 w-4" />
            שמור
          </Button>
        </CardContent>
      </Card>

      {/* Change admin PIN */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-[var(--purple)]" />
            שינוי סיסמת מנהל
          </CardTitle>
          <CardDescription>שנה את קוד הגישה לפאנל הניהול</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="oldPin">סיסמה נוכחית</Label>
              <div className="relative">
                <Input
                  id="oldPin"
                  type={showPins ? 'text' : 'password'}
                  value={oldPin}
                  onChange={(e) => { setOldPin(e.target.value); setPinError('') }}
                  placeholder="הזן סיסמה נוכחית"
                  className="pe-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPins(!showPins)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {showPins ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPin">סיסמה חדשה</Label>
              <Input
                id="newPin"
                type={showPins ? 'text' : 'password'}
                value={newPin}
                onChange={(e) => { setNewPin(e.target.value); setPinError('') }}
                placeholder="לפחות 4 תווים"
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPin">אישור סיסמה חדשה</Label>
              <Input
                id="confirmPin"
                type={showPins ? 'text' : 'password'}
                value={confirmPin}
                onChange={(e) => { setConfirmPin(e.target.value); setPinError('') }}
                placeholder="הזן שוב את הסיסמה החדשה"
                autoComplete="new-password"
              />
            </div>
            {pinError && (
              <p className="text-sm text-[var(--red)]" role="alert">{pinError}</p>
            )}
            <Button
              type="submit"
              disabled={!oldPin || !newPin || !confirmPin}
              className="w-full lg:w-auto lg:self-start"
            >
              <KeyRound className="h-4 w-4" />
              שנה סיסמה
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
