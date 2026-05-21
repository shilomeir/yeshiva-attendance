import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

// ── Icons ──────────────────────────────────────────────────────────────────
type IconName = 'shield' | 'lock' | 'eye' | 'eyeOff' | 'check' | 'x' | 'arrow' | 'key'
const Icon = ({
  name,
  size = 16,
  sw = 1.6,
  style,
}: {
  name: IconName
  size?: number
  sw?: number
  style?: React.CSSProperties
}) => {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
    'aria-hidden': true,
  }
  switch (name) {
    case 'shield':
      return (
        <svg {...p}>
          <path d="M12 3l8 3v6c0 4.6-3.2 8.4-8 9-4.8-.6-8-4.4-8-9V6l8-3z" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...p}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'eyeOff':
      return (
        <svg {...p}>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17.3 17.3 0 0 1-3.2 4" />
          <path d="M6.2 7.4A17.3 17.3 0 0 0 2 12s3.5 6 10 6c1.6 0 3-.3 4.3-.8" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      )
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )
    case 'key':
      return (
        <svg {...p}>
          <circle cx="9" cy="14" r="4" />
          <path d="M12 13l8-8" />
          <path d="M17 7l3 3" />
        </svg>
      )
    default:
      return null
  }
}

// ── Time helpers ───────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')

const useNow = () => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const GEMATRIA_TABLE: [number, string][] = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'],
  [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'],
  [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'],
  [19, 'יט'], [18, 'יח'], [17, 'יז'], [16, 'טז'], [15, 'טו'],
  [10, 'י'],
  [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'],
  [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
]
const toGematria = (n: number): string => {
  let out = ''
  let rem = n
  for (const [val, letter] of GEMATRIA_TABLE) {
    while (rem >= val) {
      out += letter
      rem -= val
    }
  }
  if (out.length === 0) return ''
  if (out.length === 1) return out + '׳'
  return out.slice(0, -1) + '״' + out.slice(-1)
}

const useHebrewDate = (date: Date) =>
  useMemo(() => {
    try {
      const raw = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date)
      const numbers = raw.match(/\d+/g) || []
      const dayN = parseInt(numbers[0] || '0', 10)
      const yearN = parseInt(numbers[numbers.length - 1] || '0', 10)
      const month = raw.replace(/\d+/g, '').replace(/\s+/g, ' ').trim()
      return `${toGematria(dayN)} ${month} ${toGematria(yearN % 1000)}`
    } catch {
      return ''
    }
  }, [date.getDate(), date.getMonth(), date.getFullYear()])

const useWeekday = (date: Date) =>
  useMemo(
    () => new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(date),
    [date.getDay()]
  )

// ── Zmanim (static for Hebron, current date) ──────────────────────────────
const ZMANIM = [
  { key: 'sunrise', label: 'זריחה', time: '05:38' },
  { key: 'shema', label: 'סוף ק"ש', time: '09:09' },
  { key: 'mincha', label: 'מנחה', time: '13:10' },
  { key: 'sunset', label: 'שקיעה', time: '19:36' },
  { key: 'tzet', label: 'צאת', time: '20:06' },
]

// ── Zmanim card ────────────────────────────────────────────────────────────
const Zmanim = () => {
  const now = useNow()
  const heb = useHebrewDate(now)
  const currentKey = useMemo(() => {
    const mins = now.getHours() * 60 + now.getMinutes()
    for (const z of ZMANIM) {
      const [h, m] = z.time.split(':').map(Number)
      if (h * 60 + m >= mins) return z.key
    }
    return null
  }, [now.getHours(), now.getMinutes()])

  return (
    <div className="ls-zmanim">
      <div className="ls-zmanim-date">
        <div className="ls-zmanim-date-heb">{heb}</div>
        <div className="ls-zmanim-date-loc">חברון · זמני היום</div>
      </div>
      <div className="ls-zmanim-row">
        {ZMANIM.map((z) => (
          <div
            key={z.key}
            className={'ls-zmanim-cell' + (z.key === currentKey ? ' ls-is-current' : '')}
          >
            <div className="ls-zmanim-cell-label">{z.label}</div>
            <div className="ls-zmanim-cell-value">{z.time}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Clock pill ─────────────────────────────────────────────────────────────
const Clock = () => {
  const now = useNow()
  const weekday = useWeekday(now)
  return (
    <div className="ls-clock">
      <span className="ls-clock-dot" aria-hidden="true" />
      <span className="ls-clock-time">
        {pad(now.getHours())}:{pad(now.getMinutes())}
        <span className="ls-clock-sec">:{pad(now.getSeconds())}</span>
      </span>
      <span className="ls-clock-sep" aria-hidden="true" />
      <span className="ls-clock-day">{weekday}</span>
    </div>
  )
}

// ── Student mode ───────────────────────────────────────────────────────────
type LoginStatus = 'idle' | 'loading' | 'success' | 'error'

const StudentMode = ({
  onLogin,
}: {
  onLogin: (id: string) => Promise<{ ok: boolean; msg?: string }>
}) => {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<LoginStatus>('idle')
  const [errMsg, setErrMsg] = useState('תעודת זהות לא נמצאה במערכת')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  useEffect(() => {
    if (value.length < 9 && status === 'error') setStatus('idle')
  }, [value, status])

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (value.length !== 9 || status === 'loading' || status === 'success') return
    setStatus('loading')
    const result = await onLogin(value)
    if (result.ok) {
      setStatus('success')
    } else {
      setErrMsg(result.msg ?? 'תעודת זהות לא נמצאה במערכת')
      setStatus('error')
      setTimeout(() => {
        setValue('')
        setStatus('idle')
      }, 1600)
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (status === 'loading' || status === 'success') return
    setValue(e.target.value.replace(/\D/g, '').slice(0, 9))
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Backspace', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.key) || e.metaKey || e.ctrlKey) {
      if (e.key === 'Enter') submit()
      return
    }
    if (!/^\d$/.test(e.key)) e.preventDefault()
  }

  const activeIdx = Math.min(value.length, 8)

  const btnLabel =
    status === 'success'
      ? 'התחברת בהצלחה'
      : status === 'error'
        ? errMsg
        : status === 'loading'
          ? 'מאמת...'
          : 'המשך'

  return (
    <form onSubmit={submit} noValidate className="ls-banner-mode">
      <span className="ls-field-label">תעודת זהות</span>
      <div className={'ls-id-wrap ls-state-' + status}>
        <div className="ls-id-input" onClick={() => inputRef.current?.focus()}>
          <input
            ref={inputRef}
            className="ls-id-hidden"
            type="text"
            inputMode="numeric"
            name="student-id-nofill"
            autoComplete="one-time-code"
            data-form-type="other"
            data-lpignore="true"
            spellCheck={false}
            aria-label="מספר תעודת זהות"
            value={value}
            onChange={onChange}
            onKeyDown={onKey}
            maxLength={9}
          />
          <div className="ls-id-boxes">
            {Array.from({ length: 9 }).map((_, i) => {
              const filled = i < value.length
              const active = i === activeIdx && status === 'idle'
              const cls =
                'ls-id-box' +
                (filled ? ' ls-is-filled' : ' ls-is-empty') +
                (active ? ' ls-is-active' : '')
              return (
                <div
                  key={i}
                  className={cls}
                  data-sep={i === 3 || i === 6 ? 'true' : 'false'}
                >
                  {filled ? value[i] : ''}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className={'ls-helper' + (status === 'error' ? ' ls-is-error' : '')}>
        {status === 'error' ? errMsg : 'הקלידו 9 ספרות לרישום נוכחות'}
      </div>
      <button
        type="submit"
        className={
          'ls-submit' +
          (status === 'loading' ? ' ls-is-loading' : '') +
          (status === 'error' ? ' ls-is-error' : '') +
          (status === 'success' ? ' ls-is-success' : '')
        }
        disabled={value.length !== 9 || status === 'loading' || status === 'success'}
      >
        {status === 'loading' && <span className="ls-spinner" aria-hidden="true" />}
        {status === 'idle' && (
          <>
            <span>{btnLabel}</span>
            <span className="ls-submit-arrow">
              <Icon name="arrow" size={16} sw={1.9} />
            </span>
          </>
        )}
        {status === 'success' && (
          <>
            <Icon name="check" size={17} sw={2.3} />
            <span>{btnLabel}</span>
          </>
        )}
        {status === 'error' && (
          <>
            <Icon name="x" size={17} sw={2.3} />
            <span>{btnLabel}</span>
          </>
        )}
      </button>
    </form>
  )
}

// ── Admin mode ─────────────────────────────────────────────────────────────
const AdminMode = ({
  onLogin,
}: {
  onLogin: (pin: string) => Promise<{ ok: boolean }>
}) => {
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [status, setStatus] = useState<LoginStatus>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin || status === 'loading' || status === 'success') return
    setStatus('loading')
    const result = await onLogin(pin)
    if (result.ok) {
      setStatus('success')
    } else {
      setStatus('error')
      setTimeout(() => {
        setPin('')
        setStatus('idle')
      }, 1500)
    }
  }

  const btnLabel =
    status === 'success'
      ? 'התחברת בהצלחה'
      : status === 'error'
        ? 'קוד גישה שגוי'
        : status === 'loading'
          ? 'מאמת...'
          : 'כניסה'

  return (
    <form onSubmit={submit} noValidate className="ls-banner-mode">
      <span className="ls-field-label">קוד גישה</span>
      <div className="ls-field ls-field-mb">
        <div
          className={
            'ls-field-shell' + (status === 'error' ? ' ls-field-error' : '')
          }
        >
          <span className="ls-ficon">
            <Icon name="lock" size={16} sw={1.7} />
          </span>
          <input
            ref={inputRef}
            type={showPin ? 'text' : 'password'}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value)
              if (status === 'error') setStatus('idle')
            }}
            placeholder="••••••••"
            autoComplete="current-password"
            dir="ltr"
          />
          <button
            type="button"
            className="ls-field-toggle"
            onClick={() => setShowPin((v) => !v)}
            aria-label={showPin ? 'הסתר קוד' : 'הצג קוד'}
          >
            <Icon name={showPin ? 'eyeOff' : 'eye'} size={16} sw={1.7} />
          </button>
        </div>
      </div>
      <div className={'ls-helper' + (status === 'error' ? ' ls-is-error' : '')}>
        {status === 'error' ? 'קוד גישה שגוי' : 'איזור מנהלים — גישה מאובטחת'}
      </div>
      <button
        type="submit"
        className={
          'ls-submit' +
          (status === 'loading' ? ' ls-is-loading' : '') +
          (status === 'error' ? ' ls-is-error' : '') +
          (status === 'success' ? ' ls-is-success' : '')
        }
        disabled={!pin || status === 'loading' || status === 'success'}
      >
        {status === 'loading' && <span className="ls-spinner" aria-hidden="true" />}
        {status === 'idle' && (
          <>
            <span>{btnLabel}</span>
            <span className="ls-submit-arrow">
              <Icon name="arrow" size={16} sw={1.9} />
            </span>
          </>
        )}
        {status === 'success' && (
          <>
            <Icon name="check" size={17} sw={2.3} />
            <span>{btnLabel}</span>
          </>
        )}
        {status === 'error' && (
          <>
            <Icon name="x" size={17} sw={2.3} />
            <span>{btnLabel}</span>
          </>
        )}
      </button>
    </form>
  )
}

// ── Banner ─────────────────────────────────────────────────────────────────
const Banner = ({
  onStudentLogin,
  onAdminLogin,
}: {
  onStudentLogin: (id: string) => Promise<{ ok: boolean; msg?: string }>
  onAdminLogin: (pin: string) => Promise<{ ok: boolean }>
}) => {
  const [mode, setMode] = useState<'student' | 'admin'>('student')

  return (
    <div className="ls-banner-wrap">
      <div className="ls-banner-halo" aria-hidden="true" />
      <div className="ls-banner">
        <div className="ls-banner-head">
          <div className="ls-banner-emblem" aria-hidden="true">
            <span className="ls-banner-emblem-letter">ש</span>
          </div>
          <h1 className="ls-banner-title">
            {mode === 'student' ? 'כניסה למערכת' : 'כניסת מנהל'}
          </h1>
          <div className="ls-banner-sub">
            {mode === 'student' ? 'מערכת נוכחות · שבי חברון' : 'איזור מנהלים'}
          </div>
        </div>

        {mode === 'student' ? (
          <StudentMode key="student" onLogin={onStudentLogin} />
        ) : (
          <AdminMode key="admin" onLogin={onAdminLogin} />
        )}

        <div className="ls-banner-foot">
          {mode === 'student' ? (
            <button type="button" onClick={() => setMode('admin')}>
              <Icon name="key" size={13} sw={1.8} />
              כניסת מנהל
            </button>
          ) : (
            <button
              type="button"
              className="ls-is-active"
              onClick={() => setMode('student')}
            >
              <Icon
                name="arrow"
                size={13}
                sw={1.8}
                style={{ transform: 'scaleX(-1)' }}
              />
              חזרה לכניסת תלמיד
            </button>
          )}
        </div>
      </div>
      {mode === 'student' && <Zmanim />}
    </div>
  )
}

// ── Main LoginScreen ───────────────────────────────────────────────────────
export function LoginScreen() {
  const navigate = useNavigate()
  const { login, loginAdmin, loginClassSupervisor, currentUser, isAdmin, classSupervisor } =
    useAuthStore()

  // Auto-login with remembered ID
  useEffect(() => {
    const rememberedId = localStorage.getItem('yeshiva_remembered_id')
    if (rememberedId) {
      login(rememberedId).then((success) => {
        if (success) {
          navigate('/student', { replace: true })
        } else {
          localStorage.removeItem('yeshiva_remembered_id')
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (currentUser) return <Navigate to="/student" replace />
  if (isAdmin) return <Navigate to="/admin" replace />
  if (classSupervisor) return <Navigate to="/class-supervisor" replace />

  const handleStudentLogin = async (idNumber: string) => {
    const ok = await login(idNumber)
    if (ok) {
      sessionStorage.setItem('show_remember_me', '1')
      sessionStorage.setItem('last_login_id', idNumber)
      navigate('/student', { replace: true })
    }
    return { ok, msg: ok ? undefined : 'תעודת זהות לא נמצאה במערכת' }
  }

  const handleAdminLogin = async (pin: string) => {
    const adminOk = await loginAdmin(pin)
    if (adminOk) {
      navigate('/admin', { replace: true })
      return { ok: true }
    }
    const supervisorOk = await loginClassSupervisor(pin)
    if (supervisorOk) {
      navigate('/class-supervisor', { replace: true })
      return { ok: true }
    }
    return { ok: false }
  }

  return (
    <>
      <style>{loginScreenCSS}</style>
      <div className="ls-page" dir="rtl">
        {/* Exterior photo (left ~70%) */}
        <div className="ls-ext" aria-hidden="true">
          <div className="ls-ext-photo" />
          <div className="ls-ext-tint" />
          <div className="ls-ext-vignette" />
          <div className="ls-ext-grain" />
        </div>

        {/* Interior wedge (right ~30%) */}
        <div className="ls-int" aria-hidden="true">
          <div className="ls-int-photo" />
          <div className="ls-int-tint" />
          <div className="ls-int-vignette" />
        </div>

        {/* Diagonal seam */}
        <div className="ls-seam" aria-hidden="true">
          <svg preserveAspectRatio="none" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="ls-seam-shadow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="rgba(15,27,45,0)" />
                <stop offset="0.9" stopColor="rgba(15,27,45,0.30)" />
                <stop offset="1" stopColor="rgba(15,27,45,0.0)" />
              </linearGradient>
            </defs>
            <polygon
              points="60,0 65,0 75,100 70,100"
              fill="url(#ls-seam-shadow)"
              opacity="0.7"
            />
            <line
              x1="65" y1="0" x2="75" y2="100"
              stroke="rgba(234, 224, 203, 0.7)"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="65.4" y1="0" x2="75.4" y2="100"
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        {/* Yeshiva caption (bottom-left) */}
        <div className="ls-ext-caption">
          <div className="ls-ext-caption-tag">צוות מערכות ופיתוח</div>
          <h2 className="ls-ext-caption-name">
            ישיבת
            <br />
            שבי חברון
          </h2>
          <div className="ls-ext-caption-rule" />
          <div className="ls-ext-caption-meta">מערכת נוכחות</div>
        </div>

        {/* Clock (top-right) */}
        <Clock />

        {/* Glass banner centered on diagonal */}
        <Banner onStudentLogin={handleStudentLogin} onAdminLogin={handleAdminLogin} />
      </div>
    </>
  )
}

// ── Scoped CSS ─────────────────────────────────────────────────────────────
const loginScreenCSS = `
  .ls-page {
    position: fixed;
    inset: 0;
    overflow: hidden;
    isolation: isolate;
    background: #0F1B2D;
    font-family: "Heebo", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    --ls-sky-800: #1B2E48;
    --ls-sky-900: #0F1B2D;
    --ls-gold-100: #F3E2B6;
    --ls-gold-300: #D9B768;
    --ls-ink: #0F1B2D;
    --ls-ink-soft: #2C3D55;
    --ls-ink-mute: #5A6878;
    --ls-ink-faint: #9AA6B5;
    --ls-line: rgba(15,27,45,0.08);
    --ls-line-2: rgba(15,27,45,0.14);
    --ls-accent: #2E6FB8;
    --ls-accent-glow: rgba(46,111,184,0.22);
    --ls-success: #1F8A5B;
    --ls-danger: #C53B3B;
    --ls-danger-glow: rgba(197,59,59,0.22);
    --ls-seam-top: 65%;
    --ls-seam-bottom: 75%;
    --ls-banner-w: 380px;
    --ls-font-display: "Frank Ruhl Libre", "Heebo", Georgia, serif;
    --ls-font-num: "SF Pro Display", "Heebo", system-ui, sans-serif;
  }

  /* Exterior */
  .ls-ext {
    position: absolute; inset: 0; z-index: 0;
  }
  .ls-ext-photo {
    position: absolute; inset: 0;
    background: url("/yeshiva.jpg") center 38% / cover no-repeat;
    filter: saturate(0.82) brightness(0.94);
    transform: scale(1.04);
  }
  .ls-ext-tint {
    position: absolute; inset: 0;
    background:
      radial-gradient(120% 80% at 30% 30%, rgba(120,160,200,0.20) 0%, transparent 60%),
      linear-gradient(180deg, rgba(15,27,45,0.06) 0%, rgba(27,46,72,0.18) 50%, rgba(15,27,45,0.55) 100%),
      linear-gradient(180deg, rgba(180,205,230,0.16), rgba(180,205,230,0.16));
  }
  .ls-ext-vignette {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 90% at 30% 50%, transparent 40%, rgba(15,27,45,0.5) 100%);
  }
  .ls-ext-grain {
    position: absolute; inset: 0; pointer-events: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    opacity: 0.05;
    mix-blend-mode: overlay;
  }

  /* Interior wedge */
  .ls-int {
    position: absolute; inset: 0; z-index: 2;
    clip-path: polygon(var(--ls-seam-top) 0, 100% 0, 100% 100%, var(--ls-seam-bottom) 100%);
    animation: ls-wedge-in 1.1s cubic-bezier(.2,.7,.2,1) both;
  }
  .ls-int-photo {
    position: absolute; inset: 0;
    background: url("/beit-midrash.jpg") center 55% / cover no-repeat;
  }
  .ls-int-tint {
    position: absolute; inset: 0;
    background:
      radial-gradient(80% 60% at 50% 35%, rgba(217,183,104,0.10) 0%, transparent 60%),
      linear-gradient(180deg, rgba(15,27,45,0.12) 0%, rgba(27,46,72,0.28) 60%, rgba(15,27,45,0.65) 100%);
  }
  .ls-int-vignette {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(140% 90% at 90% 40%, transparent 35%, rgba(15,27,45,0.50) 100%);
  }

  /* Seam */
  .ls-seam {
    position: absolute; inset: 0; z-index: 3; pointer-events: none;
  }
  .ls-seam svg {
    position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;
  }

  /* Exterior caption */
  .ls-ext-caption {
    position: absolute; z-index: 5;
    left: 72px; bottom: 72px;
    color: #FFF;
    text-shadow: 0 1px 24px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.3);
    max-width: 460px;
    animation: ls-caption-in 0.9s cubic-bezier(.2,.7,.2,1) 0.35s both;
  }
  .ls-ext-caption-tag {
    font-size: 11px; font-weight: 500; letter-spacing: 0.32em; text-transform: uppercase;
    color: rgba(255,255,255,0.82); margin-bottom: 18px;
    display: inline-flex; align-items: center; gap: 12px;
  }
  .ls-ext-caption-tag::before {
    content: ""; width: 28px; height: 1px; background: rgba(255,255,255,0.7);
  }
  .ls-ext-caption-name {
    font-family: var(--ls-font-display);
    font-size: 56px; font-weight: 500; letter-spacing: -0.015em;
    line-height: 1.02; margin: 0 0 18px;
  }
  .ls-ext-caption-rule {
    width: 64px; height: 1px; background: rgba(255,255,255,0.45); margin-bottom: 16px;
  }
  .ls-ext-caption-meta {
    font-size: 12.5px; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(255,255,255,0.8); font-weight: 500;
  }

  /* Clock */
  .ls-clock {
    position: absolute; z-index: 12; top: 42px; right: 42px;
    display: inline-flex; align-items: center; gap: 12px;
    padding: 9px 16px 9px 14px; border-radius: 999px;
    background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.24);
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    color: #FFF;
    animation: ls-chrome-in 1.0s cubic-bezier(.2,.7,.2,1) 0.5s both;
  }
  .ls-clock-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #B7E5C8; box-shadow: 0 0 0 3px rgba(183,229,200,0.22);
    animation: ls-pulse 2.4s ease-in-out infinite;
  }
  @keyframes ls-pulse {
    0%, 100% { box-shadow: 0 0 0 3px rgba(183,229,200,0.18); }
    50%       { box-shadow: 0 0 0 6px rgba(183,229,200,0.08); }
  }
  .ls-clock-time {
    font-family: var(--ls-font-num); font-size: 15px; font-weight: 500;
    letter-spacing: 0.01em; font-variant-numeric: tabular-nums;
  }
  .ls-clock-sec { color: rgba(255,255,255,0.55); margin-inline-start: 2px; font-weight: 400; }
  .ls-clock-sep { width: 1px; height: 13px; background: rgba(255,255,255,0.32); }
  .ls-clock-day { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.86); }

  /* Banner wrap */
  .ls-banner-wrap {
    position: absolute; z-index: 15;
    top: 50%;
    left: calc((var(--ls-seam-top) + var(--ls-seam-bottom)) / 2);
    transform: translate(-50%, -50%);
    width: var(--ls-banner-w);
    animation: ls-banner-in 0.9s cubic-bezier(.2,.7,.2,1) 0.2s both;
  }
  .ls-banner-halo {
    position: absolute; inset: -28px; z-index: -1; border-radius: 36px;
    background: radial-gradient(closest-side, rgba(255,255,255,0.20), transparent 70%);
    filter: blur(28px); pointer-events: none;
  }
  .ls-banner {
    position: relative;
    background: rgba(255,255,255,0.78);
    border-radius: 24px; border: 1px solid rgba(255,255,255,0.85);
    backdrop-filter: blur(34px) saturate(1.5);
    -webkit-backdrop-filter: blur(34px) saturate(1.5);
    padding: 32px 32px 28px;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.9),
      0 1px 0 rgba(255,255,255,0.5),
      0 24px 70px -20px rgba(15,27,45,0.55),
      0 80px 140px -50px rgba(15,27,45,0.55);
  }
  .ls-banner::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 50%;
    border-radius: 24px 24px 0 0;
    background: linear-gradient(180deg, rgba(255,255,255,0.32), transparent 100%);
    pointer-events: none;
  }

  /* Banner head */
  .ls-banner-head { text-align: center; margin-bottom: 22px; }
  .ls-banner-emblem {
    width: 50px; height: 50px; border-radius: 14px;
    background: linear-gradient(160deg, #FFF 0%, #E6EEF6 100%);
    border: 1px solid rgba(15,27,45,0.10);
    box-shadow: inset 0 1px 0 rgba(255,255,255,1), 0 6px 18px -6px rgba(15,27,45,0.22);
    display: grid; place-items: center; margin: 0 auto 14px;
  }
  .ls-banner-emblem-letter {
    font-family: var(--ls-font-display);
    font-size: 26px; font-weight: 500; color: var(--ls-sky-800);
    line-height: 1; letter-spacing: -0.02em;
  }
  .ls-banner-title {
    font-family: var(--ls-font-display);
    font-size: 26px; font-weight: 500; color: var(--ls-ink);
    letter-spacing: -0.01em; line-height: 1.1; margin: 0 0 6px;
  }
  .ls-banner-sub {
    font-size: 12px; color: var(--ls-ink-mute);
    letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500;
  }

  /* Field label */
  .ls-field-label {
    display: block; font-size: 10.5px; font-weight: 600; color: var(--ls-ink-mute);
    letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 10px;
    padding-inline-start: 4px;
  }

  /* ID input */
  .ls-id-input { position: relative; }
  .ls-id-hidden {
    position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%;
    border: 0; outline: 0; background: transparent; font-size: 16px;
    cursor: text; caret-color: transparent; z-index: 2;
  }
  .ls-id-boxes { display: flex; gap: 5px; direction: ltr; justify-content: space-between; }
  .ls-id-box {
    flex: 1; height: 50px; border-radius: 10px;
    background: rgba(255,255,255,0.92); border: 1px solid var(--ls-line-2);
    display: grid; place-items: center;
    font-family: var(--ls-font-num); font-size: 19px; font-weight: 500;
    font-variant-numeric: tabular-nums; color: var(--ls-ink); position: relative;
    transition: border-color .18s ease, background .18s ease, box-shadow .22s ease, transform .22s cubic-bezier(.2,.7,.2,1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,1), 0 1px 2px rgba(15,27,45,0.04);
    box-sizing: border-box;
  }
  .ls-id-box[data-sep="true"] { margin-inline-start: 8px; }
  .ls-id-box.ls-is-filled {
    border-color: rgba(15,27,45,0.22);
    animation: ls-digit-in .22s cubic-bezier(.2,.7,.2,1);
  }
  @keyframes ls-digit-in {
    0%   { transform: translateY(3px); opacity: 0.3; }
    100% { transform: translateY(0); opacity: 1; }
  }
  .ls-id-input:focus-within .ls-id-box.ls-is-active {
    border-color: var(--ls-accent); background: #FFF;
    box-shadow: 0 0 0 3px var(--ls-accent-glow), inset 0 1px 0 rgba(255,255,255,1);
  }
  .ls-id-input:focus-within .ls-id-box.ls-is-active.ls-is-empty::after {
    content: ""; position: absolute; width: 1.5px; height: 22px;
    background: var(--ls-accent); border-radius: 2px;
    animation: ls-blink 1.1s ease-in-out infinite;
  }
  @keyframes ls-blink {
    0%, 49%   { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
  .ls-id-wrap.ls-state-error .ls-id-boxes { animation: ls-shake .42s cubic-bezier(.36,.07,.19,.97); }
  .ls-id-wrap.ls-state-error .ls-id-box {
    border-color: var(--ls-danger); background: #FFF5F5; color: var(--ls-danger);
  }
  @keyframes ls-shake {
    10%, 90%          { transform: translateX(-1px); }
    20%, 80%          { transform: translateX(2px); }
    30%, 50%, 70%     { transform: translateX(-4px); }
    40%, 60%          { transform: translateX(4px); }
  }
  .ls-id-wrap.ls-state-success .ls-id-box {
    border-color: var(--ls-success); color: var(--ls-success); background: #F2FBF6;
  }

  /* Admin field */
  .ls-field { }
  .ls-field-mb { margin-bottom: 4px; }
  .ls-field-shell {
    display: flex; align-items: center; height: 48px; padding: 0 14px;
    background: rgba(255,255,255,0.92); border: 1px solid var(--ls-line-2);
    border-radius: 12px; gap: 10px;
    transition: all .15s ease; box-shadow: inset 0 1px 0 rgba(255,255,255,1);
  }
  .ls-field-shell:focus-within {
    border-color: var(--ls-accent); background: #FFF;
    box-shadow: 0 0 0 3px var(--ls-accent-glow), inset 0 1px 0 rgba(255,255,255,1);
  }
  .ls-field-shell.ls-field-error { border-color: var(--ls-danger); }
  .ls-ficon { color: var(--ls-ink-faint); display: grid; place-items: center; }
  .ls-field-shell:focus-within .ls-ficon { color: var(--ls-accent); }
  .ls-field-shell input {
    flex: 1; border: 0; outline: 0; background: transparent;
    font-size: 14.5px; font-family: inherit; color: var(--ls-ink); height: 100%;
  }
  .ls-field-shell input::placeholder { color: var(--ls-ink-faint); }
  .ls-field-toggle {
    border: 0; background: transparent; color: var(--ls-ink-faint);
    padding: 4px; border-radius: 6px; display: grid; place-items: center;
    transition: color .15s ease; cursor: pointer;
  }
  .ls-field-toggle:hover { color: var(--ls-ink); }

  /* Helper */
  .ls-helper {
    font-size: 12px; color: var(--ls-ink-mute); text-align: start;
    padding-inline-start: 4px; margin-top: 10px; margin-bottom: 16px;
    min-height: 16px; transition: color .2s ease;
  }
  .ls-helper.ls-is-error { color: var(--ls-danger); }

  /* Submit */
  .ls-submit {
    position: relative; width: 100%; height: 50px; border-radius: 13px;
    border: 0; background: var(--ls-ink); color: #FFF;
    font-size: 14px; font-weight: 500; letter-spacing: 0.02em;
    font-family: inherit; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    overflow: hidden; transition: all .22s cubic-bezier(.2,.7,.2,1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 2px rgba(15,27,45,0.2), 0 10px 24px -12px rgba(15,27,45,0.5);
  }
  .ls-submit:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 14px 32px -14px rgba(15,27,45,0.55);
  }
  .ls-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .ls-submit.ls-is-success { background: var(--ls-success); }
  .ls-submit.ls-is-error   { background: var(--ls-danger); }
  .ls-submit-arrow { display: inline-grid; place-items: center; transition: transform .22s ease; }
  .ls-submit:hover:not(:disabled) .ls-submit-arrow { transform: translateX(-3px); }
  .ls-spinner {
    width: 16px; height: 16px;
    border: 1.8px solid rgba(255,255,255,0.32); border-top-color: #FFF;
    border-radius: 50%; animation: ls-spin .7s linear infinite;
  }
  @keyframes ls-spin { to { transform: rotate(360deg); } }

  /* Mode animation */
  .ls-banner-mode { animation: ls-mode-in .32s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes ls-mode-in {
    0%   { opacity: 0; transform: translateY(6px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  /* Banner footer */
  .ls-banner-foot {
    display: flex; justify-content: center; align-items: center;
    gap: 8px; margin-top: 18px; padding-top: 16px;
    border-top: 1px solid var(--ls-line);
  }
  .ls-banner-foot button {
    border: 0; background: transparent;
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 500; color: var(--ls-ink-mute);
    letter-spacing: 0.04em; padding: 6px 10px; border-radius: 8px;
    transition: all .15s ease; cursor: pointer; font-family: inherit;
  }
  .ls-banner-foot button:hover { color: var(--ls-ink); background: rgba(15,27,45,0.05); }
  .ls-banner-foot button.ls-is-active { color: var(--ls-accent); }

  /* Zmanim */
  .ls-zmanim {
    position: absolute; top: calc(100% + 16px); left: 50%; transform: translateX(-50%);
    z-index: 12;
    display: inline-flex; align-items: stretch; padding: 12px 4px;
    background: rgba(15,27,45,0.36); border: 1px solid rgba(234,224,203,0.18);
    border-radius: 14px;
    backdrop-filter: blur(16px) saturate(1.3);
    -webkit-backdrop-filter: blur(16px) saturate(1.3);
    color: #FFF; white-space: nowrap;
    animation: ls-zmanim-in 1.0s cubic-bezier(.2,.7,.2,1) 0.5s both;
  }
  .ls-zmanim-date {
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 18px; border-inline-end: 1px solid rgba(234,224,203,0.18); text-align: center;
  }
  .ls-zmanim-date-heb {
    font-family: var(--ls-font-display); font-size: 15px; font-weight: 500; line-height: 1.1;
  }
  .ls-zmanim-date-loc {
    font-size: 10px; color: rgba(234,224,203,0.62); letter-spacing: 0.16em;
    text-transform: uppercase; margin-top: 4px; font-weight: 500;
  }
  .ls-zmanim-row { display: flex; align-items: center; padding: 0 4px; }
  .ls-zmanim-cell {
    display: flex; flex-direction: column; align-items: center;
    padding: 0 14px; position: relative; min-width: 64px;
  }
  .ls-zmanim-cell + .ls-zmanim-cell::before {
    content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 1px; height: 22px; background: rgba(234,224,203,0.14);
  }
  .ls-zmanim-cell-label {
    font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(234,224,203,0.68); font-weight: 500; margin-bottom: 3px;
  }
  .ls-zmanim-cell-value {
    font-family: var(--ls-font-num); font-size: 13.5px; font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .ls-zmanim-cell.ls-is-current .ls-zmanim-cell-value { color: var(--ls-gold-100); }
  .ls-zmanim-cell.ls-is-current::after {
    content: ""; position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%);
    width: 4px; height: 4px; border-radius: 50%;
    background: var(--ls-gold-300); box-shadow: 0 0 8px rgba(217,183,104,0.7);
  }

  /* Entrance animations */
  @keyframes ls-wedge-in  { 0% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes ls-banner-in {
    0%   { opacity: 0; transform: translate(-50%, -46%); }
    100% { opacity: 1; transform: translate(-50%, -50%); }
  }
  @keyframes ls-caption-in {
    0%   { opacity: 0; transform: translateY(14px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes ls-chrome-in {
    0%   { opacity: 0; transform: translateY(-6px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes ls-zmanim-in {
    0%   { opacity: 0; transform: translate(-50%, 6px); }
    100% { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes ls-zmanim-in-mob {
    0%   { opacity: 0; transform: translateY(6px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  /* ── Responsive — desktop tall ───────────────────────────────────── */
  @media (max-height: 820px) {
    .ls-ext-caption { bottom: 56px; left: 56px; }
    .ls-ext-caption-name { font-size: 44px; }
    .ls-banner { padding: 26px 28px 22px; }
    .ls-banner-emblem { width: 44px; height: 44px; margin-bottom: 10px; }
    .ls-banner-emblem-letter { font-size: 22px; }
    .ls-banner-title { font-size: 22px; }
    .ls-banner-head { margin-bottom: 18px; }
    .ls-id-box { height: 46px; font-size: 18px; }
    .ls-submit { height: 46px; }
  }
  @media (max-height: 680px) {
    .ls-banner { padding: 22px 24px 20px; }
    .ls-banner-emblem { display: none; }
    .ls-banner-title { font-size: 20px; }
    .ls-banner-sub { font-size: 11px; }
    .ls-banner-head { margin-bottom: 14px; }
    .ls-id-box { height: 42px; font-size: 17px; }
    .ls-field-shell { height: 42px; }
    .ls-submit { height: 44px; }
    .ls-helper { margin-top: 8px; margin-bottom: 12px; }
    .ls-banner-foot { margin-top: 12px; padding-top: 12px; }
    .ls-zmanim { display: none; }
  }

  /* ── Responsive — wide desktop ────────────────────────────────────── */
  @media (max-width: 1100px) {
    .ls-page { --ls-seam-top: 55%; --ls-seam-bottom: 70%; --ls-banner-w: 360px; }
    .ls-ext-caption-name { font-size: 44px; }
    .ls-ext-caption { max-width: 360px; }
  }

  /* ── Responsive — tablet (820px) ─────────────────────────────────── */
  @media (max-width: 820px) {
    .ls-page { --ls-seam-top: 40%; --ls-seam-bottom: 55%; --ls-banner-w: min(420px, 88vw); }
    .ls-ext-caption { display: none; }
    .ls-banner-wrap { left: 50%; }
    .ls-zmanim {
      width: 100%; left: 0; transform: none; white-space: normal;
      animation: ls-zmanim-in-mob 1.0s cubic-bezier(.2,.7,.2,1) 0.5s both;
    }
    .ls-zmanim-cell { flex: 1; min-width: 0; }
  }

  /* ── Responsive — mobile (640px) ─────────────────────────────────── */
  @media (max-width: 640px) {
    /* Hide split-screen elements — full exterior photo only */
    .ls-int { display: none; }
    .ls-seam { display: none; }

    /* Darker overlay so text is readable */
    .ls-ext-tint {
      background:
        linear-gradient(180deg,
          rgba(15,27,45,0.20) 0%,
          rgba(15,27,45,0.40) 50%,
          rgba(15,27,45,0.72) 100%);
    }

    /* Clock — compact, stays top-right */
    .ls-clock {
      top: 14px; right: 14px;
      padding: 6px 12px 6px 10px; gap: 7px;
    }
    .ls-clock-time { font-size: 13px; }
    .ls-clock-sep, .ls-clock-day { display: none; }

    /* Banner — centered, full-width with padding */
    .ls-page { --ls-banner-w: min(400px, calc(100vw - 32px)); }
    .ls-banner-wrap {
      left: 50%;
      top: 50%;
      /* shift up to make room for the zmanim strip below */
      transform: translate(-50%, calc(-50% - 24px));
    }
    .ls-banner-halo { display: none; }
    .ls-banner {
      padding: 24px 20px 20px;
      border-radius: 20px;
    }
    .ls-banner::before { border-radius: 20px 20px 0 0; }
    .ls-banner-emblem { width: 42px; height: 42px; border-radius: 12px; margin-bottom: 10px; }
    .ls-banner-emblem-letter { font-size: 20px; }
    .ls-banner-title { font-size: 21px; }
    .ls-banner-sub { font-size: 11px; letter-spacing: 0.12em; }
    .ls-banner-head { margin-bottom: 16px; }

    /* ID boxes — slightly smaller to fit 9 in a row on narrow screens */
    .ls-id-boxes { gap: 3px; }
    .ls-id-box { height: 42px; font-size: 17px; border-radius: 8px; }
    .ls-id-box[data-sep="true"] { margin-inline-start: 5px; }

    /* Admin field */
    .ls-field-shell { height: 46px; }

    /* Submit & footer */
    .ls-submit { height: 46px; font-size: 14px; }
    .ls-helper { margin-top: 8px; margin-bottom: 14px; }
    .ls-banner-foot { margin-top: 14px; padding-top: 14px; }

    /* Zmanim — compact strip below the banner on mobile */
    .ls-zmanim {
      padding: 8px 2px; top: calc(100% + 10px); border-radius: 12px;
      animation: ls-zmanim-in-mob 1.0s cubic-bezier(.2,.7,.2,1) 0.5s both;
    }
    .ls-zmanim-date { padding: 0 10px; }
    .ls-zmanim-date-heb { font-size: 13px; }
    .ls-zmanim-date-loc { font-size: 8.5px; letter-spacing: 0.12em; }
    .ls-zmanim-cell { padding: 0 6px; }
    .ls-zmanim-cell-label { font-size: 8.5px; letter-spacing: 0.08em; }
    .ls-zmanim-cell-value { font-size: 12px; }
  }

  /* ── Responsive — very small phones (360px) ──────────────────────── */
  @media (max-width: 360px) {
    .ls-page { --ls-banner-w: calc(100vw - 24px); }
    .ls-banner { padding: 20px 16px 18px; }
    .ls-banner-emblem { display: none; }
    .ls-id-boxes { gap: 2px; }
    .ls-id-box { height: 38px; font-size: 16px; border-radius: 7px; }
    .ls-id-box[data-sep="true"] { margin-inline-start: 4px; }
    .ls-banner-title { font-size: 19px; }
  }

  /* Hide zmanim when screen height is too short (landscape / old phones) */
  @media (max-width: 820px) and (max-height: 680px) {
    .ls-zmanim { display: none; }
  }

  /* ── Safe area insets (iPhone notch / Dynamic Island) ────────────── */
  @supports (padding: max(0px)) {
    .ls-clock {
      top: max(14px, env(safe-area-inset-top));
      right: max(14px, env(safe-area-inset-right));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ls-page *, .ls-page *::before, .ls-page *::after {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
`
