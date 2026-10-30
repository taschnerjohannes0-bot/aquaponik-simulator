import { useCallback, useEffect, useRef, useState } from 'react'
import { GreenhouseView } from './render/greenhouse.ts'
import { durationText, syncToRealClock } from './sim/actions.ts'
import { addLog, advance, currentAir, refreshLive } from './sim/simulate.ts'
import { clearSave, load, newGame, save, type GameState } from './sim/state.ts'
import { FishPanel } from './ui/FishPanel.tsx'
import { clock, dateLabel, dayNo, eur, num } from './ui/format.ts'
import { HelpPanel, LogPanel } from './ui/InfoPanels.tsx'
import { PlantsPanel } from './ui/PlantsPanel.tsx'
import { ShopPanel } from './ui/ShopPanel.tsx'
import { WaterPanel } from './ui/WaterPanel.tsx'

/** Spielstunden pro Echtzeit-Sekunde */
const SPEEDS = [
  { v: 0, label: '❚❚', title: 'Pause' },
  { v: 1 / 3600, label: '1:1', title: 'Echtzeit: läuft wie in echt, auch bei geschlossener App' },
  { v: 1 / 6, label: '▶', title: '10 Minuten pro Sekunde' },
  { v: 1, label: '▶▶', title: '1 Stunde pro Sekunde' },
  { v: 6, label: '▶▶▶', title: '6 Stunden pro Sekunde' },
  { v: 24, label: '⏩', title: '1 Tag pro Sekunde' },
]

const REAL = 1
/** So viel verpasste Zeit wird beim Öffnen höchstens nachgeholt */
const MAX_CATCHUP_H = 24 * 14

type Tab = 'wasser' | 'fische' | 'pflanzen' | 'technik' | 'tagebuch' | 'hilfe'
const TABS: { id: Tab; label: string }[] = [
  { id: 'wasser', label: 'Wasser' },
  { id: 'fische', label: 'Fische' },
  { id: 'pflanzen', label: 'Pflanzen' },
  { id: 'technik', label: 'Technik' },
  { id: 'tagebuch', label: 'Tagebuch' },
  { id: 'hilfe', label: 'Hilfe' },
]

export default function App() {
  const game = useRef<GameState>(refreshLive(load() ?? newGame()))
  const [speed, setSpeed] = useState(() => game.current.flags._speed ?? 3)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const [, setTick] = useState(0)
  const [tab, setTab] = useState<Tab>('wasser')
  const [selected, setSelected] = useState(-1)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [toast, setToast] = useState<{ text: string; kind: string } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [showHint, setShowHint] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setShowHint(false), 9000)
    return () => clearTimeout(id)
  }, [])

  const rerender = useCallback(() => setTick((t) => t + 1), [])
  const act = useCallback(
    (fn: (s: GameState) => void) => {
      fn(game.current)
      refreshLive(game.current)
      save(game.current)
      rerender()
    },
    [rerender],
  )

  const pickSpeed = (i: number) => {
    const wasReal = speedRef.current === REAL
    act((g) => {
      g.flags._speed = i
      if (i === REAL && !wasReal) syncToRealClock(g)
      g.flags._wall = Date.now()
    })
    setSpeed(i)
  }

  // Hauptschleife: Simulation + Zeichnen
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastUi = 0
    let lastSave = 0
    let seenLog = game.current.flags._seq ?? 0
    const view = new GreenhouseView(canvas.current!, {
      onSlot: (slot) => {
        setSelected(slot)
        setTab('pflanzen')
      },
      onTank: () => setTab('fische'),
    })
    const frame = (now: number) => {
      const dtReal = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = game.current
      const wall = Date.now()
      if (speedRef.current === REAL) {
        // Echtzeit: genau so viel Spielzeit wie echte Zeit vergangen ist, auch während die App zu war
        const gap = Math.max(0, (wall - (s.flags._wall ?? wall)) / 3.6e6)
        advance(s, Math.min(gap, MAX_CATCHUP_H))
        if (gap > 0.5)
          addLog(
            s,
            'info',
            gap > MAX_CATCHUP_H
              ? `Du warst ${durationText(gap)} weg. Nachgeholt wurden die letzten 14 Tage. Im Tagebuch steht, was passiert ist.`
              : `Du warst ${durationText(gap)} weg. Im Tagebuch steht, was in der Zeit passiert ist.`,
          )
      } else {
        const hours = SPEEDS[speedRef.current].v * dtReal
        if (hours > 0) advance(s, hours)
      }
      s.flags._wall = wall
      s.flags._speed = speedRef.current
      const seq = s.flags._seq ?? 0
      if (seq < seenLog) seenLog = seq
      if (seq !== seenLog) {
        const fresh = s.log.slice(-Math.min(s.log.length, seq - seenLog))
        seenLog = seq
        const newest = fresh[fresh.length - 1]
        if (newest) {
          setToast({ text: newest.text, kind: newest.kind })
          if (fresh.some((l) => l.kind === 'bad') && speedRef.current > REAL) setSpeed(0)
        }
      }
      view.render(s, now / 1000, selectedRef.current, speedRef.current > 0)
      if (now - lastUi > 250) {
        lastUi = now
        setTick((t) => t + 1)
      }
      if (now - lastSave > 3000) {
        lastSave = now
        save(s)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const onHide = () => save(game.current)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      cancelAnimationFrame(raf)
      view.dispose()
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  const s = game.current
  return (
    <div className="app">
      <header className="topbar">
        <div className="when">
          <strong>Tag {dayNo(s.t)}</strong>
          <span>
            {dateLabel(s.startDoy, s.t)} · {clock(s.t)}
          </span>
        </div>
        <div className="stat" title="Wassertemperatur / Luft">
          🌡 {num(s.water.temp)}° <small>Luft {num(currentAir(s), 0)}°</small>
        </div>
        {s.outage > 0 && <div className="stat outage">⚡ Stromausfall</div>}
        <div className={`stat money ${s.money < 0 ? 'neg' : ''}`}>{eur(s.money)}</div>
      </header>

      <div className="scene-wrap">
        <canvas ref={canvas} className="scene" />
        {showHint && <div className="hint">Nach oben wischen: durchs Gewächshaus gehen · zur Seite: umschauen · Tippen: auswählen</div>}
        {toast && (
          <div className={`toast ${toast.kind}`} onClick={() => setTab('tagebuch')}>
            {toast.text}
          </div>
        )}
        <div className="speeds">
          {SPEEDS.map((sp, i) => (
            <button key={i} title={sp.title} className={i === speed ? 'on' : ''} onClick={() => pickSpeed(i)}>
              {sp.label}
            </button>
          ))}
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'wasser' && <WaterPanel s={s} act={act} />}
        {tab === 'fische' && <FishPanel s={s} act={act} />}
        {tab === 'pflanzen' && <PlantsPanel s={s} act={act} selected={selected} setSelected={setSelected} />}
        {tab === 'technik' && <ShopPanel s={s} act={act} />}
        {tab === 'tagebuch' && <LogPanel s={s} />}
        {tab === 'hilfe' && (
          <HelpPanel
            onTestMoney={() =>
              act((g) => {
                g.money += 10000
                addLog(g, 'info', 'Testgeld: 10.000 € gutgeschrieben.')
              })
            }
            onReset={() => {
              clearSave()
              game.current = refreshLive(newGame())
              setSelected(-1)
              setSpeed(3)
              rerender()
            }}
          />
        )}
      </main>
    </div>
  )
}
