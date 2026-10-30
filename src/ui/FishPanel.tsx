import { useState } from 'react'
import { buyFish, fishValue, removeDead, sellFish } from '../sim/actions.ts'
import { FISH, FISH_IDS, type FishId } from '../sim/data.ts'
import { biomassKg, dropFeed, fishDailyRation } from '../sim/simulate.ts'
import type { GameState } from '../sim/state.ts'
import { eur, grams, num } from './format.ts'

export function FishPanel({ s, act }: { s: GameState; act: (fn: (s: GameState) => void) => void }) {
  const [buySpecies, setBuySpecies] = useState<FishId>('karpfen')
  const [buyCount, setBuyCount] = useState(20)
  const kg = biomassKg(s)
  const portion = (pct: number) => Math.max(2, kg * 1000 * pct)
  const e = s.equip
  const sp = FISH[buySpecies]
  return (
    <div className="panel">
      {s.water.deadCount > 0 && (
        <div className="alert bad">
          <span>{s.water.deadCount} tote Fische treiben im Tank.</span>
          <button onClick={() => act(removeDead)}>Entfernen</button>
        </div>
      )}

      <div className="panel-head">
        <h2>Füttern</h2>
        <span className="muted">Vorrat {grams(s.feedStock)}</span>
      </div>
      <p className="muted small">
        Fischmasse {num(kg, 2)} kg. {s.water.floatingFeed > 0.5 ? `Noch ${grams(s.water.floatingFeed)} Futter schwimmen im Wasser.` : ''} Was die
        Fische nicht fressen, sinkt ab und verrottet zu Ammonium.
      </p>
      <div className="actions three">
        <button disabled={!s.fish.length} onClick={() => act((g) => dropFeed(g, portion(0.005)))}>
          Wenig <small>{grams(portion(0.005))}</small>
        </button>
        <button disabled={!s.fish.length} onClick={() => act((g) => dropFeed(g, portion(0.01)))}>
          Normal <small>{grams(portion(0.01))}</small>
        </button>
        <button disabled={!s.fish.length} onClick={() => act((g) => dropFeed(g, portion(0.02)))}>
          Viel <small>{grams(portion(0.02))}</small>
        </button>
      </div>
      {e.autoFeeder && (
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={e.autoFeederOn} onChange={(ev) => act((g) => (g.equip.autoFeederOn = ev.target.checked))} />
            Futterautomat
          </label>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={e.autoFeedRate}
            onChange={(ev) => act((g) => (g.equip.autoFeedRate = Number(ev.target.value)))}
          />
          <span className="nowrap">{num(e.autoFeedRate, 2)} % / Tag</span>
        </div>
      )}

      <div className="panel-head">
        <h2>Deine Fische</h2>
      </div>
      {!s.fish.length && <p className="muted">Noch keine Fische im Tank.</p>}
      {s.fish.map((g) => {
        const f = FISH[g.species]
        const daily = fishDailyRation(g)
        const full = g.stomach / (daily * 0.45)
        return (
          <div className="card" key={g.id}>
            <div className="card-row">
              <strong>
                {g.count} × {f.name}
              </strong>
              <span>Ø {grams(g.weight)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${g.health}%`, background: g.health > 70 ? '#4caf50' : g.health > 40 ? '#e0a23a' : '#d0453b' }} />
            </div>
            <div className="card-row small muted">
              <span>
                Gesundheit {Math.round(g.health)} % · {full > 0.6 ? 'satt' : full > 0.15 ? 'frisst' : g.hoursHungry > 48 ? 'sehr hungrig' : 'hungrig'}
              </span>
              <span>
                Ziel {grams(f.harvestWeight)} · {num(f.optMin, 0)}–{num(f.optMax, 0)} °C
              </span>
            </div>
            <button onClick={() => act((st) => sellFish(st, g.id))}>
              Abfischen und verkaufen <small>{eur(fishValue(g))}</small>
            </button>
          </div>
        )
      })}

      <div className="panel-head">
        <h2>Fische kaufen</h2>
      </div>
      <div className="chips">
        {FISH_IDS.map((id) => (
          <button key={id} className={id === buySpecies ? 'chip on' : 'chip'} onClick={() => setBuySpecies(id)}>
            {FISH[id].name}
          </button>
        ))}
      </div>
      <div className="card">
        <p className="small">{sp.info}</p>
        <p className="small muted">
          Wohlfühltemperatur {sp.optMin}–{sp.optMax} °C · mind. {sp.doMin} mg/L Sauerstoff · Jungfisch {sp.startWeight} g · Verkauf {eur(sp.pricePerKg)}/kg ab{' '}
          {grams(sp.harvestWeight)}
        </p>
        <div className="row">
          <input type="range" min={5} max={150} step={5} value={buyCount} onChange={(ev) => setBuyCount(Number(ev.target.value))} />
          <span className="nowrap">{buyCount} Stück</span>
        </div>
        <button className="primary wide" onClick={() => act((g) => buyFish(g, buySpecies, buyCount))}>
          {buyCount} {sp.name} einsetzen für {eur(sp.priceFingerling * buyCount)}
        </button>
      </div>
    </div>
  )
}
