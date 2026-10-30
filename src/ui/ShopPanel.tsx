import type { ReactNode } from 'react'
import {
  buyAutoFeeder,
  buyBed,
  buyEquip,
  buyFeed,
  buyHeater,
  buyMbbr,
  buyProbes,
  buyTests,
  upgradeAirPump,
  upgradeMechFilter,
  upgradeTank,
  type EquipItem,
} from '../sim/actions.ts'
import { MAX_BEDS, MAX_MBBR, PRICES, SLUDGE_CAP, TANK_SIZES } from '../sim/data.ts'
import type { Equipment, GameState } from '../sim/state.ts'
import { eur, num } from './format.ts'

type Act = (fn: (s: GameState) => void) => void
type BoolKey = { [K in keyof Equipment]: Equipment[K] extends boolean ? K : never }[keyof Equipment]

function Switch({ e, k, act }: { e: Equipment; k: BoolKey; act: Act }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={e[k]} onChange={(ev) => act((g) => (g.equip[k] = ev.target.checked))} />
      {e[k] ? 'an' : 'aus'}
    </label>
  )
}

function Card({ title, right, text, children }: { title: string; right?: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-row">
        <strong>{title}</strong>
        {right}
      </div>
      <p className="small muted">{text}</p>
      {children}
    </div>
  )
}

/** Gerät, das man einmal kauft; danach evtl. Schalter und Einstellungen */
function Item(props: { s: GameState; act: Act; k: EquipItem; title: string; text: string; sw?: BoolKey; children?: ReactNode }) {
  const { s, act, k, title, text, sw, children } = props
  const e = s.equip
  const owned = e[k]
  const right = !owned ? undefined : sw ? <Switch e={e} k={sw} act={act} /> : <span className="muted">vorhanden</span>
  return (
    <Card title={title} text={text} right={right}>
      {owned ? (
        children
      ) : (
        <button onClick={() => act((g) => buyEquip(g, k))}>
          Kaufen <small>{eur(PRICES[k])}</small>
        </button>
      )}
    </Card>
  )
}

function Slider(props: { value: number; min: number; max: number; step: number; unit: string; digits?: number; onChange: (v: number) => void }) {
  const { value, min, max, step, unit, digits = 1, onChange } = props
  return (
    <div className="row">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(ev) => onChange(Number(ev.target.value))} />
      <span className="nowrap">
        {num(value, digits)} {unit}
      </span>
    </div>
  )
}

const Status = ({ on, yes, no }: { on: boolean; yes: string; no: string }) => <p className={`small ${on ? 'on-text' : 'muted'}`}>{on ? yes : no}</p>

export function ShopPanel({ s, act }: { s: GameState; act: Act }) {
  const e = s.equip
  const live = s.live
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Technik</h2>
        <span className="muted">
          gerade {num(live.watts, 0)} W · bisher {num(s.energyKWh, 0)} kWh
        </span>
      </div>
      {s.outage > 0 && (
        <div className={`alert ${e.generator ? 'warn' : 'bad'}`}>
          Stromausfall, noch etwa {num(Math.max(1, s.outage), 0)} h.{' '}
          {e.generator ? 'Das Notstromaggregat läuft.' : e.batteryAir ? 'Nur die Akku-Luftpumpe läuft.' : 'Pumpen und Belüftung stehen still!'}
        </div>
      )}

      <h3>Wasserkreislauf</h3>
      <Card
        title="Wasserpumpe"
        right={<Switch e={e} k="pumpOn" act={act} />}
        text="Pumpt das Wasser vom Fischbecken über die Filter in die Pflanzbeete und zurück. Ohne Pumpe trocknen die Beete aus."
      />
      <Card
        title={e.mechFilter === 2 ? 'Trommelfilter' : e.mechFilter === 1 ? 'Radialabscheider' : 'Feststofffilter'}
        right={e.mechFilter ? <span className="muted">Stufe {e.mechFilter} von 2</span> : undefined}
        text={
          e.mechFilter === 2
            ? 'Siebt Kot und Futterreste mit feinem Gewebe heraus und spült sich selbst frei. Braucht etwas Wasser und Strom.'
            : e.mechFilter === 1
              ? `Kot und Futterreste setzen sich in einem Trichter ab. Schlamm darin: ${num(s.water.sludge, 0)} von ${SLUDGE_CAP} g. Ablassen geht unter „Wasser“.`
              : 'Holt Kot und Futterreste aus dem Wasser, bevor sie faulen und Sauerstoff verbrauchen. In Profi-Anlagen Pflicht.'
        }
      >
        {e.mechFilter < 2 && (
          <button onClick={() => act(upgradeMechFilter)}>
            {e.mechFilter === 0 ? 'Radialabscheider' : 'Trommelfilter'} <small>{eur(PRICES.mechFilter[e.mechFilter + 1])}</small>
          </button>
        )}
      </Card>
      <Card
        title="MBBR-Biofilter"
        right={
          <span className="muted">
            {e.mbbr} von {MAX_MBBR}
          </span>
        }
        text="Belüfteter Behälter mit schwimmenden Kunststoffkörpern. Darauf wachsen sehr viele Bakterien, die Ammonium und Nitrit abbauen. So verträgt die Anlage viel mehr Fische."
      >
        {e.mbbr < MAX_MBBR && (
          <button onClick={() => act(buyMbbr)}>
            Modul einbauen <small>{eur(PRICES.mbbr)}</small>
          </button>
        )}
      </Card>
      <Item s={s} act={act} k="degasser" title="Rieselturm (Entgaser)" text="Das Wasser rieselt über Füllkörper. Dabei entweicht CO₂, der pH-Wert steigt, und Sauerstoff kommt hinein." />
      <Item s={s} act={act} k="uv" title="UV-Klärer" text="Bestrahlt das Wasser mit UV-Licht. Tötet Krankheitserreger und Schwebealgen, die Fische werden seltener krank." />
      <Item s={s} act={act} k="mineralizer" title="Mineralisierer" text="Belüfteter Tank, in dem Bakterien den Fischschlamm zersetzen. Dabei werden Nitrat und Eisen für die Pflanzen frei.">
        <p className="small">Im Tank: {num(s.water.mineral, 0)} g Schlamm</p>
      </Item>
      <Item s={s} act={act} k="doser" title="Dosierstation" sw="doserOn" text="Misst laufend und gibt automatisch Puffer und Eisen zu, sobald die Werte unter den Sollwert fallen.">
        <p className="small">Karbonathärte halten bei</p>
        <Slider value={e.doserKh} min={1} max={6} step={0.5} unit="°dKH" onChange={(v) => act((g) => (g.equip.doserKh = v))} />
        <p className="small">Eisen halten bei</p>
        <Slider value={e.doserFe} min={0.5} max={3} step={0.1} unit="mg/L" onChange={(v) => act((g) => (g.equip.doserFe = v))} />
      </Item>

      <h3>Luft und Sauerstoff</h3>
      <Card
        title="Luftpumpe"
        right={<span className="muted">Stufe {e.airPump} von 3</span>}
        text="Mehr Fische, mehr Futter und wärmeres Wasser brauchen mehr Sauerstoff."
      >
        {e.airPump < 3 && (
          <button onClick={() => act(upgradeAirPump)}>
            Auf Stufe {e.airPump + 1} <small>{eur(PRICES.airPump[e.airPump + 1])}</small>
          </button>
        )}
      </Card>
      <Item
        s={s}
        act={act}
        k="oxygen"
        title="Sauerstoffkonzentrator"
        sw="oxygenOn"
        text="Gewinnt reinen Sauerstoff aus der Luft und löst ihn über feine Steine im Wasser. Erlaubt sehr viele Fische, braucht aber 350 W."
      />

      <h3>Sicherheit und Steuerung</h3>
      <Item s={s} act={act} k="batteryAir" title="Akku-Luftpumpe" text="Springt bei Stromausfall an und versorgt die Fische mit Luft. Die Wasserpumpe steht dann trotzdem." />
      <Item s={s} act={act} k="generator" title="Notstromaggregat" text="Diesel-Generator, der bei Stromausfall automatisch alles weiterlaufen lässt." />
      <Card title="Messsonden" right={e.probes ? <span className="muted">vorhanden</span> : undefined} text="Zeigen alle Wasserwerte live an, zeichnen den Verlauf auf und schlagen Alarm.">
        {!e.probes && (
          <button onClick={() => act(buyProbes)}>
            Kaufen <small>{eur(PRICES.probes)}</small>
          </button>
        )}
      </Card>
      <Card
        title="Futterautomat"
        right={e.autoFeeder ? <span className="muted">vorhanden</span> : undefined}
        text="Füttert um 8, 13 und 18 Uhr. Die Menge stellst du bei den Fischen ein."
      >
        {!e.autoFeeder && (
          <button onClick={() => act(buyAutoFeeder)}>
            Kaufen <small>{eur(PRICES.autoFeeder)}</small>
          </button>
        )}
      </Card>
      <Card
        title="Heizstab im Becken"
        right={e.heater ? <Switch e={e} k="heaterOn" act={act} /> : undefined}
        text="Hält das Wasser warm, z. B. für Tilapia. Braucht 300 W."
      >
        {e.heater ? (
          <Slider value={e.heaterSet} min={14} max={30} step={0.5} unit="°C" onChange={(v) => act((g) => (g.equip.heaterSet = v))} />
        ) : (
          <button onClick={() => act(buyHeater)}>
            Kaufen <small>{eur(PRICES.heater)}</small>
          </button>
        )}
      </Card>

      <h3>Gewächshaus</h3>
      <p className="small muted">
        Luft {num(live.air, 0)} °C · Sonne {Math.round(live.light * 100)} %{live.ledActive ? ' · LED an' : ''}
        {live.venting ? ' · lüftet' : ''}
        {live.shading ? ' · schattiert' : ''}
        {live.airHeating ? ' · heizt' : ''}
      </p>
      <Item
        s={s}
        act={act}
        k="airHeater"
        title="Warmluftheizer (Gas)"
        sw="airHeaterOn"
        text="Heizt die Luft im Folientunnel. Pflanzen wachsen im Winter weiter und das Wasser kühlt weniger aus. Gas kostet."
      >
        <Slider value={e.airHeaterSet} min={5} max={20} step={1} unit="°C" digits={0} onChange={(v) => act((g) => (g.equip.airHeaterSet = v))} />
        <Status on={live.airHeating} yes="heizt gerade" no="heizt gerade nicht" />
      </Item>
      <Item
        s={s}
        act={act}
        k="climate"
        title="Lüftung und Schattierung"
        text="Öffnet ab 24 °C die Seitenwände und lässt Ventilatoren laufen. Bei praller Sonne zieht ein Schattiernetz zu. Verhindert Hitzestress im Sommer."
      >
        <Status on={live.venting} yes={live.shading ? 'lüftet und schattiert gerade' : 'lüftet gerade'} no="gerade nicht nötig" />
      </Item>
      <Item
        s={s}
        act={act}
        k="led"
        title="LED-Pflanzenlicht"
        sw="ledOn"
        text="Lampen über den Beeten, die morgens, abends und an trüben Tagen zuschalten. Mehr Wachstum im Winter, braucht aber 150 W pro Beet."
      >
        <Status on={live.ledActive} yes="leuchtet gerade" no="aus (genug Tageslicht oder Nacht)" />
      </Item>
      <Item
        s={s}
        act={act}
        k="insectNet"
        title="Insektenschutznetz"
        text="Feines Netz an Tür und Lüftung, damit kommen Blattläuse viel seltener herein. Spritzmittel sind in Aquaponik tabu, sie würden die Fische vergiften."
      />

      <h3>Ausbau</h3>
      <Card
        title="Pflanzbeete"
        right={
          <span className="muted">
            {e.beds} von {MAX_BEDS}
          </span>
        }
        text="Mehr Beete heißt mehr Pflanzen, die Nitrat verbrauchen, und mehr Fläche für Bakterien."
      >
        {e.beds < MAX_BEDS && (
          <button onClick={() => act(buyBed)}>
            Beet bauen <small>{eur(PRICES.bed)}</small>
          </button>
        )}
      </Card>
      <Card
        title="Fischbecken"
        right={<span className="muted">{TANK_SIZES[e.tankLevel]} L</span>}
        text="Mehr Becken und mehr Wasser vertragen mehr Fische und reagieren langsamer auf Fehler."
      >
        {e.tankLevel < TANK_SIZES.length - 1 && (
          <button onClick={() => act(upgradeTank)}>
            Auf {TANK_SIZES[e.tankLevel + 1]} L <small>{eur(PRICES.tank[e.tankLevel + 1])}</small>
          </button>
        )}
      </Card>

      <h3>Laden</h3>
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
      <p className="muted small">
        Strom kostet {eur(PRICES.kWh)} pro kWh, Gas {eur(PRICES.gasKWh)} pro kWh. Beides wird laufend abgebucht.
      </p>
    </div>
  )
}
