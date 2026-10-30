import { buyAutoFeeder, buyBed, buyFeed, buyHeater, buyProbes, buyTests, upgradeAirPump, upgradeTank } from '../sim/actions.ts'
import { AIR_WATT, MAX_BEDS, PRICES, TANK_SIZES } from '../sim/data.ts'
import type { GameState } from '../sim/state.ts'
import { eur, num } from './format.ts'

export function ShopPanel({ s, act }: { s: GameState; act: (fn: (s: GameState) => void) => void }) {
  const e = s.equip
  const heating = e.heater && e.heaterOn && s.water.temp < e.heaterSet
  const watts = (e.pumpOn ? 40 : 0) + AIR_WATT[e.airPump] + (heating ? 300 : 0)
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Technik</h2>
        <span className="muted">gerade {watts} W · bisher {num(s.energyKWh, 0)} kWh</span>
      </div>

      <div className="card">
        <div className="card-row">
          <strong>Wasserpumpe</strong>
          <label className="switch">
            <input type="checkbox" checked={e.pumpOn} onChange={(ev) => act((g) => (g.equip.pumpOn = ev.target.checked))} />
            {e.pumpOn ? 'an' : 'aus'}
          </label>
        </div>
        <p className="small muted">Pumpt Wasser ins Pflanzbeet, wo Bakterien und Pflanzen es reinigen. Ohne Pumpe trocknet das Beet aus.</p>
      </div>

      <div className="card">
        <div className="card-row">
          <strong>Luftpumpe</strong>
          <span>Stufe {e.airPump} von 3</span>
        </div>
        <p className="small muted">Mehr Fische, mehr Futter und wärmeres Wasser brauchen mehr Sauerstoff.</p>
        {e.airPump < 3 && (
          <button onClick={() => act(upgradeAirPump)}>
            Auf Stufe {e.airPump + 1} <small>{eur(PRICES.airPump[e.airPump + 1])}</small>
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-row">
          <strong>Heizstab 300 W</strong>
          {e.heater && (
            <label className="switch">
              <input type="checkbox" checked={e.heaterOn} onChange={(ev) => act((g) => (g.equip.heaterOn = ev.target.checked))} />
              {e.heaterOn ? 'an' : 'aus'}
            </label>
          )}
        </div>
        {e.heater ? (
          <div className="row">
            <input type="range" min={14} max={30} step={0.5} value={e.heaterSet} onChange={(ev) => act((g) => (g.equip.heaterSet = Number(ev.target.value)))} />
            <span className="nowrap">{num(e.heaterSet)} °C</span>
          </div>
        ) : (
          <>
            <p className="small muted">Hält das Wasser warm, z. B. für Tilapia. Kostet Strom.</p>
            <button onClick={() => act(buyHeater)}>
              Kaufen <small>{eur(PRICES.heater)}</small>
            </button>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-row">
          <strong>Futterautomat</strong>
          <span>{e.autoFeeder ? 'vorhanden' : ''}</span>
        </div>
        <p className="small muted">Füttert um 8, 13 und 18 Uhr. Die Menge stellst du bei den Fischen ein.</p>
        {!e.autoFeeder && (
          <button onClick={() => act(buyAutoFeeder)}>
            Kaufen <small>{eur(PRICES.autoFeeder)}</small>
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-row">
          <strong>Messsonden</strong>
          <span>{e.probes ? 'vorhanden' : ''}</span>
        </div>
        <p className="small muted">Zeigen alle Wasserwerte live an, zeichnen den Verlauf auf und warnen dich bei Problemen.</p>
        {!e.probes && (
          <button onClick={() => act(buyProbes)}>
            Kaufen <small>{eur(PRICES.probes)}</small>
          </button>
        )}
      </div>

      <div className="panel-head">
        <h2>Ausbau</h2>
      </div>
      <div className="card">
        <div className="card-row">
          <strong>Pflanzbeete</strong>
          <span>
            {e.beds} von {MAX_BEDS}
          </span>
        </div>
        <p className="small muted">Mehr Beete heißt mehr Pflanzen, die Nitrat verbrauchen, und mehr Platz für Bakterien.</p>
        {e.beds < MAX_BEDS && (
          <button onClick={() => act(buyBed)}>
            Beet bauen <small>{eur(PRICES.bed)}</small>
          </button>
        )}
      </div>
      <div className="card">
        <div className="card-row">
          <strong>Fischtank</strong>
          <span>{TANK_SIZES[e.tankLevel]} L</span>
        </div>
        <p className="small muted">Mehr Wasser verträgt mehr Fische und reagiert langsamer auf Fehler.</p>
        {e.tankLevel < TANK_SIZES.length - 1 && (
          <button onClick={() => act(upgradeTank)}>
            Auf {TANK_SIZES[e.tankLevel + 1]} L <small>{eur(PRICES.tank[e.tankLevel + 1])}</small>
          </button>
        )}
      </div>

      <div className="panel-head">
        <h2>Laden</h2>
      </div>
      <div className="actions">
        <button onClick={() => act((g) => buyFeed(g, 5))}>
          Fischfutter 5 kg <small>{eur(PRICES.feedKg * 5)}</small>
        </button>
        <button onClick={() => act((g) => buyFeed(g, 20))}>
          Fischfutter 20 kg <small>{eur(PRICES.feedKg * 20)}</small>
        </button>
        <button onClick={() => act(buyTests)}>
          Wassertest-Set, 20 Messungen <small>{eur(PRICES.testKit)}</small>
        </button>
      </div>
      <p className="muted small">Strom kostet {eur(PRICES.kWh)} pro kWh und wird laufend abgebucht.</p>
    </div>
  )
}
