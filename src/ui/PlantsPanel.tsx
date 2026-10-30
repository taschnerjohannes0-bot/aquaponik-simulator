import { useState } from 'react'
import { harvest, plantSeedling, plantValue, releaseBeneficials, removePlant } from '../sim/actions.ts'
import { PLANTS, PLANT_IDS, PRICES, SLOTS_PER_BED, type PlantId } from '../sim/data.ts'
import { plantMaxMass } from '../sim/simulate.ts'
import type { GameState, Plant } from '../sim/state.ts'
import { eur, grams, num } from './format.ts'

const SHORT: Record<PlantId, string> = { salat: 'Sal', basilikum: 'Bas', minze: 'Min', mangold: 'Man', tomate: 'Tom' }
const COLOR: Record<PlantId, string> = { salat: '#6dbb4a', basilikum: '#3f8f3a', minze: '#5fb08a', mangold: '#c0503b', tomate: '#d6322a' }

function status(p: Plant) {
  const sp = PLANTS[p.species]
  if (p.dead) return 'eingegangen'
  const out: string[] = []
  if (sp.fruiting) {
    if (p.fruit > 50) out.push(`${grams(p.fruit)} Früchte`)
    else if (p.ageH / 24 > sp.fruiting.startDay) out.push('blüht')
  } else if (p.mass >= sp.harvestMass) out.push('erntereif')
  if (p.chlorosis > 0.35) out.push('gelbe Blätter')
  if (p.nDeficit > 0.4) out.push('blass')
  if (p.health < 50) out.push('welk')
  return out.join(', ')
}

export function PlantsPanel({
  s,
  act,
  selected,
  setSelected,
}: {
  s: GameState
  act: (fn: (s: GameState) => void) => void
  selected: number
  setSelected: (n: number) => void
}) {
  const [species, setSpecies] = useState<PlantId>('salat')
  const p = selected >= 0 ? s.slots[selected] : null
  const free = s.slots.filter((x) => !x).length
  const ripe = s.slots.map((x, i) => (x && (x.dead || (!PLANTS[x.species].fruiting && x.mass >= PLANTS[x.species].harvestMass) || x.fruit > 200) ? i : -1)).filter((i) => i >= 0)
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Pflanzbeete</h2>
        <span className="muted">Tippe auf einen Platz</span>
      </div>
      {(s.pests > 0.08 || s.beneficials > 0.05) && (
        <div className={`alert ${s.pests > 0.4 ? 'bad' : s.pests > 0.08 ? 'warn' : 'good'}`}>
          {s.pests > 0.08 ? `Blattläuse: ${s.pests > 0.4 ? 'starker' : s.pests > 0.2 ? 'mittlerer' : 'leichter'} Befall. ` : 'Keine Blattläuse zu sehen. '}
          {s.beneficials > 0.05 ? `Nützlinge sind unterwegs (${Math.round(s.beneficials * 100)} %).` : 'Gift ist tabu, es würde die Fische töten.'}
          {s.beneficials < 0.3 && s.pests > 0.08 && (
            <button onClick={() => act(releaseBeneficials)}>
              Nützlinge aussetzen <small>{eur(PRICES.beneficials)}</small>
            </button>
          )}
        </div>
      )}
      {Array.from({ length: s.equip.beds }, (_, b) => (
        <div className="bed" key={b}>
          {Array.from({ length: SLOTS_PER_BED }, (_, i) => {
            const slot = b * SLOTS_PER_BED + i
            const pl = s.slots[slot]
            const sp = pl && PLANTS[pl.species]
            const prog = pl && sp ? Math.min(1, pl.mass / sp.harvestMass) : 0
            return (
              <button
                key={slot}
                className={`slot ${slot === selected ? 'sel' : ''} ${pl?.dead ? 'dead' : ''}`}
                onClick={() => setSelected(slot === selected ? -1 : slot)}
                style={pl ? { borderColor: COLOR[pl.species] } : undefined}
              >
                {pl ? SHORT[pl.species] : '+'}
                {pl && <i style={{ width: `${prog * 100}%`, background: prog >= 1 ? '#e0a23a' : COLOR[pl.species] }} />}
              </button>
            )
          })}
        </div>
      ))}

      {ripe.length > 1 && (
        <button className="primary wide" onClick={() => act((g) => ripe.forEach((i) => harvest(g, i)))}>
          Alles Reife ernten ({ripe.length})
        </button>
      )}

      {p && (
        <div className="card">
          <div className="card-row">
            <strong>{PLANTS[p.species].name}</strong>
            <span>{num(p.ageH / 24, 0)} Tage alt</span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, (p.mass / PLANTS[p.species].harvestMass) * 100)}%`, background: COLOR[p.species] }} />
          </div>
          <div className="card-row small muted">
            <span>
              {grams(p.mass)} von {grams(PLANTS[p.species].fruiting ? plantMaxMass(PLANTS[p.species]) : PLANTS[p.species].harvestMass)} · Gesundheit{' '}
              {Math.round(p.health)} %
            </span>
            <span>{status(p)}</span>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => act((g) => harvest(g, selected))}>
              {p.dead ? 'Entfernen' : PLANTS[p.species].fruiting ? 'Früchte ernten' : 'Ernten'} <small>{eur(plantValue(p))}</small>
            </button>
            {!p.dead && (
              <button
                onClick={() => {
                  act((g) => removePlant(g, selected))
                }}
              >
                Ausreißen <small>ohne Erlös</small>
              </button>
            )}
          </div>
        </div>
      )}

      {(selected < 0 || !p) && (
        <>
          <div className="panel-head">
            <h2>Setzlinge</h2>
            <span className="muted">{free} Plätze frei</span>
          </div>
          <div className="chips">
            {PLANT_IDS.map((id) => (
              <button key={id} className={id === species ? 'chip on' : 'chip'} onClick={() => setSpecies(id)}>
                {PLANTS[id].name}
              </button>
            ))}
          </div>
          <div className="card">
            <p className="small">{PLANTS[species].info}</p>
            <p className="small muted">
              {PLANTS[species].optMin}–{PLANTS[species].optMax} °C · etwa {PLANTS[species].days} Tage bis zur Ernte ·{' '}
              {PLANTS[species].fruiting ? `${eur(PLANTS[species].price)}/kg Früchte` : `${eur(PLANTS[species].price)} pro Stück`} · Setzling{' '}
              {eur(PLANTS[species].priceSeedling)}
            </p>
            <div className="actions">
              {selected >= 0 && !p && (
                <button className="primary" onClick={() => act((g) => plantSeedling(g, selected, species))}>
                  Hier pflanzen
                </button>
              )}
              <button
                disabled={!free}
                onClick={() =>
                  act((g) =>
                    g.slots.forEach((x, i) => {
                      if (!x) plantSeedling(g, i, species)
                    }),
                  )
                }
              >
                Alle freien Plätze bepflanzen <small>{eur(free * PLANTS[species].priceSeedling)}</small>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
