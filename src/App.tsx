import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Heart, Pause, Play, RotateCcw, Sparkles, Trophy } from 'lucide-react'
import './game.css'

type Drop = { id: number; lane: number; y: number; kind: 'candy' | 'heart' | 'rock'; icon: string }

const candyIcons = ['🍭', '🍬', '🍩', '🧁', '🍪']
const lanes = [18, 50, 82]

function YaeliAvatar({ running = false }: { running?: boolean }) {
  return (
    <svg className={`yaeli-avatar ${running ? 'is-running' : ''}`} viewBox="0 0 180 260" role="img" aria-label="יעלי המאוירת">
      <defs>
        <linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffdd63"/><stop offset="1" stopColor="#ff9f5b"/></linearGradient>
        <linearGradient id="skirt" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a68bff"/><stop offset="1" stopColor="#7058db"/></linearGradient>
      </defs>
      <ellipse cx="90" cy="247" rx="61" ry="10" fill="#57318c" opacity=".18" />
      <path d="M53 76C48 24 77 8 93 9c37 1 49 28 39 77L53 76Z" fill="#3b241d"/>
      <circle cx="90" cy="66" r="45" fill="#d99163"/>
      <path d="M48 65C49 24 74 8 96 10c22 1 39 18 40 49-16-3-30-17-36-29-12 17-30 28-52 35Z" fill="#34201b"/>
      <path d="M55 58c-8 0-10 16 1 20M128 58c8 0 10 16-1 20" stroke="#d99163" strokeWidth="8" strokeLinecap="round"/>
      <path d="M65 61q9-8 18 0M101 61q9-8 18 0" fill="none" stroke="#482b26" strokeWidth="3" strokeLinecap="round"/>
      <ellipse cx="74" cy="68" rx="4.8" ry="6" fill="#32231f"/><ellipse cx="110" cy="68" rx="4.8" ry="6" fill="#32231f"/>
      <circle cx="75.5" cy="66" r="1.3" fill="white"/><circle cx="111.5" cy="66" r="1.3" fill="white"/>
      <path d="M78 88q13 12 27 0" fill="#fff" stroke="#a64f4d" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="59" cy="80" r="5" fill="#eaa07b" opacity=".7"/><circle cx="123" cy="80" r="5" fill="#eaa07b" opacity=".7"/>
      <circle cx="52" cy="74" r="3" fill="#ffd766"/><circle cx="130" cy="74" r="3" fill="#ffd766"/>
      <path d="M64 105q26-14 52 0l14 72H50l14-72Z" fill="url(#shirt)"/>
      <path d="M64 108 38 148" stroke="#d99163" strokeWidth="17" strokeLinecap="round"/><path d="M116 108l27 40" stroke="#d99163" strokeWidth="17" strokeLinecap="round"/>
      <path d="M55 168h70l19 65H37l18-65Z" fill="url(#skirt)"/>
      <path d="M67 228v20M113 228v20" stroke="#d99163" strokeWidth="16" strokeLinecap="round"/>
      <path d="M54 251h27M100 251h28" stroke="#fff" strokeWidth="13" strokeLinecap="round"/>
      <path d="M62 128q28 18 56 0" fill="none" stroke="#fff0b8" strokeWidth="4" strokeLinecap="round" opacity=".8"/>
      <path d="m91 121 4 7 8 1-6 6 2 8-8-4-7 4 1-8-6-6 8-1 4-7Z" fill="#fff6ce"/>
    </svg>
  )
}

export default function App() {
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [over, setOver] = useState(false)
  const [lane, setLane] = useState(1)
  const [jumping, setJumping] = useState(false)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [drops, setDrops] = useState<Drop[]>([])
  const counter = useRef(0)
  const laneRef = useRef(lane)
  const jumpRef = useRef(jumping)
  const best = Number(localStorage.getItem('yaeli-best') || 0)

  useEffect(() => { laneRef.current = lane }, [lane])
  useEffect(() => { jumpRef.current = jumping }, [jumping])

  const move = useCallback((direction: number) => setLane(v => Math.max(0, Math.min(2, v + direction))), [])
  const jump = useCallback(() => {
    if (!started || paused || over || jumpRef.current) return
    setJumping(true)
    window.setTimeout(() => setJumping(false), 650)
  }, [started, paused, over])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') move(-1)
      if (event.key === 'ArrowRight') move(1)
      if (event.key === 'ArrowUp' || event.key === ' ') { event.preventDefault(); jump() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [jump, move])

  useEffect(() => {
    if (!started || paused || over) return
    const timer = window.setInterval(() => {
      counter.current += 1
      setDrops(previous => {
        const updated = previous.map(drop => ({ ...drop, y: drop.y + 3.4 + Math.min(score / 400, 2.5) }))
        const next: Drop[] = []
        updated.forEach(drop => {
          if (drop.y > 77 && drop.y < 94 && drop.lane === laneRef.current) {
            if (drop.kind === 'rock') {
              if (!jumpRef.current) setLives(value => {
                const remaining = value - 1
                if (remaining <= 0) setOver(true)
                return Math.max(0, remaining)
              })
            } else {
              const points = drop.kind === 'heart' ? 25 : 10
              setScore(value => value + points)
            }
          } else if (drop.y <= 105) next.push(drop)
        })
        if (counter.current % 11 === 0) {
          const isRock = Math.random() < .24
          const isHeart = !isRock && Math.random() < .09
          next.push({ id: Date.now(), lane: Math.floor(Math.random() * 3), y: -8, kind: isRock ? 'rock' : isHeart ? 'heart' : 'candy', icon: isRock ? '🪨' : isHeart ? '💖' : candyIcons[Math.floor(Math.random() * candyIcons.length)] })
        }
        return next
      })
    }, 45)
    return () => window.clearInterval(timer)
  }, [started, paused, over, score])

  useEffect(() => { if (over && score > best) localStorage.setItem('yaeli-best', String(score)) }, [over, score, best])

  const start = () => { setScore(0); setLives(3); setDrops([]); setLane(1); setOver(false); setPaused(false); setStarted(true); counter.current = 0 }

  return (
    <main className="game-shell" dir="rtl">
      <header className="game-header">
        <div className="brand"><span className="brand-mark">Y</span><div><strong>המסע המתוק</strong><small>של יעלי</small></div></div>
        <button className="sound-pill" onClick={() => started && setPaused(v => !v)} aria-label={paused ? 'המשך משחק' : 'השהיית משחק'}>{paused ? <Play size={17}/> : <Pause size={17}/>}<span>{paused ? 'להמשיך' : 'השהיה'}</span></button>
      </header>

      <section className="game-card">
        <div className="sky"><span className="cloud cloud-one"/><span className="cloud cloud-two"/><span className="sun"/></div>
        <div className="hills hills-back"/><div className="hills hills-front"/>
        <div className="scoreboard">
          <div><small>ממתקים</small><strong>🍬 {score}</strong></div>
          <div><small>שיא אישי</small><strong><Trophy size={16}/> {Math.max(best, score)}</strong></div>
          <div className="life-row" aria-label={`${lives} לבבות`}>{[0,1,2].map(i => <Heart key={i} size={20} fill={i < lives ? 'currentColor' : 'transparent'} className={i < lives ? '' : 'empty'}/>)}</div>
        </div>

        <div className="road"><i/><i/><div className="road-dashes"><b/><b/></div></div>
        {drops.map(drop => <div key={drop.id} className={`drop drop-${drop.kind}`} style={{ left: `${lanes[drop.lane]}%`, top: `${drop.y}%` }}>{drop.icon}</div>)}
        <div className={`runner ${jumping ? 'jumping' : ''}`} style={{ left: `${lanes[lane]}%` }}><YaeliAvatar running={started && !paused && !over}/></div>

        {!started && <div className="game-overlay intro-overlay">
          <div className="intro-copy"><span className="eyebrow"><Sparkles size={15}/> משחק חדש במיוחד בשבילך</span><h1>יעלי יוצאת<br/><em>למסע מתוק!</em></h1><p>אספי כמה שיותר ממתקים, דלגי מעל הסלעים<br/>ושברי את השיא שלך.</p><button className="primary" onClick={start}><Play fill="currentColor" size={19}/> מתחילים לשחק</button><div className="controls-hint"><span>← → לזוז</span><span>↑ לקפוץ</span></div></div>
          <div className="portrait"><div className="spark s1">✦</div><div className="spark s2">✦</div><YaeliAvatar/></div>
        </div>}
        {paused && started && !over && <div className="pause-overlay"><h2>הפסקה קטנה 🍭</h2><button className="primary" onClick={() => setPaused(false)}><Play fill="currentColor"/> ממשיכים</button></div>}
        {over && <div className="pause-overlay"><span className="result-icon">🏆</span><h2>כל הכבוד, יעלי!</h2><p>אספת <strong>{score}</strong> נקודות מתוקות</p><button className="primary" onClick={start}><RotateCcw size={20}/> שוב פעם</button></div>}
      </section>

      <nav className="mobile-controls" aria-label="פקדי משחק">
        <button onClick={() => move(-1)} aria-label="שמאלה"><ChevronLeft/></button>
        <button className="jump-button" onClick={jump} aria-label="קפיצה">לקפוץ</button>
        <button onClick={() => move(1)} aria-label="ימינה"><ChevronRight/></button>
      </nav>
      <footer>נוצר במיוחד עבור יעלי <span>♥</span></footer>
    </main>
  )
}
