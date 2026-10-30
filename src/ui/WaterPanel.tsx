import { addAmmonia, addBuffer, addIron, addStarter, measure, siphon, waterChange } from '../sim/actions.ts'
import { PRICES } from '../sim/data.ts'
import { snapshot } from '../sim/simulate.ts'
import type { GameState, Reading } from '../sim/state.ts'
import { Chart } from './Chart.tsx'
import { eur, num, stamp } from './format.ts'

type Level = 'good' | 'warn' | 'bad'

interface Row {
  label: string
  value: (r: Reading) => number
  unit: string
  digits: number
  level: (v: number) => Level
  hint: string
}

const ROWS: Row[] = [
  { label: 'pH-Wert', value: (r) => r.ph, unit: '', digits: 1, level: (v) => (v < 6 || v > 8.5 ? 'bad' : v < 6.6 || v > 7.6 ? 'warn' : 'good'), hint: 'Ideal 6,8–7,2: Kompromiss aus Fischen, Bakterien und Pflanzen' },
  { label: 'Ammonium', value: (r) => r.tan, unit: 'mg/L', digits: 2, level: (v) => (v > 2 ? 'bad' : v > 0.5 ? 'warn' : 'good'), hint: 'Kommt von Fischen und Futterresten. Unter 0,5 halten' },
  { label: 'Freies Ammoniak', value: (r) => r.nh3, unit: 'mg/L', digits: 3, level: (v) => (v > 0.1 ? 'bad' : v > 0.03 ? 'warn' : 'good'), hint: 'Der giftige Anteil. Steigt mit pH und Temperatur' },
  { label: 'Nitrit', value: (r) => r.no2, unit: 'mg/L', digits: 2, level: (v) => (v > 2 ? 'bad' : v > 0.5 ? 'warn' : 'good'), hint: 'Zwischenstufe, giftig. Unter 0,5 halten' },
  { label: 'Nitrat', value: (r) => r.no3, unit: 'mg/L', digits: 0, level: (v) => (v > 150 ? 'bad' : v < 5 || v > 100 ? 'warn' : 'good'), hint: 'Pflanzendünger. 10–100 ist gut' },
  { label: 'Karbonathärte', value: (r) => r.kh, unit: '°dKH', digits: 1, level: (v) => (v < 1 ? 'bad' : v < 2.5 ? 'warn' : 'good'), hint: 'Puffer gegen pH-Absturz. Bakterien verbrauchen ihn' },
  { label: 'Sauerstoff', value: (r) => r.o2, unit: 'mg/L', digits: 1, level: (v) => (v < 3 ? 'bad' : v < 5 ? 'warn' : 'good'), hint: 'Über 5 halten. Mehr Fische brauchen mehr Luft' },
  { label: 'Eisen', value: (r) => r.fe, unit: 'mg/L', digits: 1, level: (v) => (v < 0.3 ? 'bad' : v < 1 ? 'warn' : 'good'), hint: 'Für grüne Blätter. 1–3 mg/L' },
]

export function WaterPanel({ s, act }: { s: GameState; act: (fn: (s: GameState) => void) => void }) {
  const probes = s.equip.probes
  const live = snapshot(s)
  const last = probes ? live : s.readings[s.readings.length - 1]
  const dose = s.water.volume / 1000
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Wasserwerte</h2>
        <span className="muted">{probes ? 'live von den Sonden' : last ? `gemessen ${stamp(last.t)}` : 'noch nicht gemessen'}</span>
      </div>
      <div className="values">
        <div className="value good">
          <div className="v-label">Temperatur</div>
          <div className="v-num">
            {num(live.temp)} <small>°C</small>
          </div>
          <div className="v-hint">Thermometer zeigt immer live an</div>
        </div>
        {ROWS.map((row) => {
          const v = last ? row.value(last) : undefined
          return (
            <div key={row.label} className={`value ${v === undefined ? '' : row.level(v)}`}>
              <div className="v-label">{row.label}</div>
              <div className="v-num">
                {v === undefined ? '–' : num(v, row.digits)} <small>{row.unit}</small>
              </div>
              <div className="v-hint">{row.hint}</div>
            </div>
          )
        })}
      </div>
      {!probes && (
        <button className="primary wide" onClick={() => act(measure)}>
          Wasser testen ({s.tests} Tests übrig)
        </button>
      )}

      <Chart
        title="Stickstoff-Kreislauf"
        readings={s.readings}
        series={[
          { key: 'tan', label: 'Ammonium', color: '#e0a23a' },
          { key: 'no2', label: 'Nitrit', color: '#d0453b' },
          { key: 'no3', label: 'Nitrat ÷ 10', color: '#3a8fd0', scale: 0.1 },
        ]}
      />
      <Chart title="pH-Wert" readings={s.readings} series={[{ key: 'ph', label: 'pH', color: '#7a5ad0' }]} height={110} />

      <h3>Maßnahmen</h3>
      <div className="actions">
        <button onClick={() => act((g) => waterChange(g, 0.1))}>
          10 % Wasserwechsel <small>{eur(s.water.volume * 0.1 * PRICES.waterPerLiter)}</small>
        </button>
        <button onClick={() => act((g) => waterChange(g, 0.3))}>
          30 % Wasserwechsel <small>{eur(s.water.volume * 0.3 * PRICES.waterPerLiter)}</small>
        </button>
        <button onClick={() => act(siphon)}>
          Schlamm absaugen <small>{num(s.water.solids, 0)} g Reste</small>
        </button>
        <button onClick={() => act(addBuffer)}>
          Puffer (Kaliumcarbonat) <small>+1 °dKH · {eur(PRICES.buffer * dose)}</small>
        </button>
        <button onClick={() => act(addIron)}>
          Eisen-Chelat <small>+1 mg/L · {eur(PRICES.iron * dose)}</small>
        </button>
        <button onClick={() => act(addStarter)}>
          Bakterienstarter <small>beschleunigt das Einfahren · {eur(PRICES.starter)}</small>
        </button>
        <button onClick={() => act(addAmmonia)}>
          Ammoniumchlorid <small>nur zum Einfahren ohne Fische · {eur(PRICES.ammonia * dose)}</small>
        </button>
      </div>
      <p className="muted small">
        Leitungswasser hat {12} °C. Ein großer Wasserwechsel kühlt das Becken also ab. Verdunstetes Wasser wird automatisch mit Leitungswasser
        nachgefüllt.
      </p>
    </div>
  )
}
