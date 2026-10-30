import { FISH, MAX_BEDS, MAX_MBBR, PLANTS, PRICES, SLOTS_PER_BED, TANK_SIZES, TAP, type FishId, type PlantId } from './data.ts'
import { addLog, pay, snapshot } from './simulate.ts'
import type { FishGroup, GameState, Plant } from './state.ts'

function spend(s: GameState, cost: number) {
  if (s.money < cost) {
    addLog(s, 'warn', `Dafür reicht das Geld nicht (${cost.toFixed(2)} € nötig).`)
    return false
  }
  pay(s, cost)
  return true
}

function earn(s: GameState, amount: number) {
  s.money += amount
  s.stats.revenue += amount
}

const dosesFactor = (s: GameState) => s.water.volume / 1000

// --- Wasser ---

export function measure(s: GameState) {
  if (s.tests <= 0) {
    addLog(s, 'warn', 'Keine Wassertests mehr übrig. Kaufe ein neues Testset im Laden.')
    return false
  }
  s.tests -= 1
  // Tropftests sind nicht ganz genau
  const r = snapshot(s)
  const fuzz = (x: number, rel: number) => Math.max(0, x * (1 + (Math.random() - 0.5) * rel))
  const m = { ...r, tan: fuzz(r.tan, 0.2), no2: fuzz(r.no2, 0.2), no3: fuzz(r.no3, 0.25), kh: fuzz(r.kh, 0.1), fe: fuzz(r.fe, 0.3) }
  s.readings.push(m)
  const hints: string[] = []
  if (m.nh3 > 0.05) hints.push('Das freie Ammoniak ist gefährlich hoch. Weniger füttern und einen Teil des Wassers wechseln.')
  else if (m.tan > 1) hints.push('Ammonium ist erhöht. Die Bakterien kommen noch nicht hinterher.')
  if (m.no2 > 1) hints.push('Nitrit ist hoch: Die zweite Bakteriengruppe baut sich noch auf. Sparsam füttern.')
  if (m.ph < 6.5) hints.push('Der pH-Wert ist niedrig. Gib Puffer (Kaliumcarbonat) zu.')
  if (m.ph > 7.8) hints.push('Der pH-Wert ist hoch. Pflanzen nehmen dann schlecht Eisen auf.')
  if (m.kh < 1.5) hints.push('Die Karbonathärte ist fast aufgebraucht. Ohne Puffer kann der pH-Wert abstürzen.')
  if (m.fe < 0.5 && s.slots.some((p) => p && !p.dead)) hints.push('Wenig Eisen für die Pflanzen. Eisen-Chelat zugeben.')
  if (m.o2 < 5) hints.push('Sauerstoff ist knapp. Eine stärkere Luftpumpe hilft.')
  if (m.no3 > 150) hints.push('Sehr viel Nitrat: Mehr Pflanzen oder ein Wasserwechsel helfen.')
  if (!hints.length && m.no3 > 5 && m.tan < 0.5 && m.no2 < 0.5) hints.push('Alles im grünen Bereich. Die Anlage ist eingefahren.')
  addLog(
    s,
    hints.length && !hints[0].startsWith('Alles') ? 'warn' : 'info',
    `Wassertest: pH ${m.ph.toFixed(1)}, Ammonium ${m.tan.toFixed(2)}, Nitrit ${m.no2.toFixed(2)}, Nitrat ${m.no3.toFixed(0)} mg/L. ${hints.join(' ')}`,
  )
  return true
}

export function waterChange(s: GameState, fraction: number) {
  const w = s.water
  const liters = w.volume * fraction
  if (!spend(s, liters * PRICES.waterPerLiter)) return
  w.tan *= 1 - fraction
  w.no2 *= 1 - fraction
  w.no3 = w.no3 * (1 - fraction) + TAP.no3 * fraction
  w.kh = w.kh * (1 - fraction) + TAP.kh * fraction
  w.fe = w.fe * (1 - fraction) + TAP.fe * fraction
  w.co2 = w.co2 * (1 - fraction) + TAP.co2 * fraction
  w.temp = w.temp * (1 - fraction) + TAP.temp * fraction
  w.o2 = w.o2 * (1 - fraction) + 9.5 * fraction
  w.solids *= 1 - fraction * 0.5
  w.salt *= 1 - fraction
  addLog(s, 'info', `${Math.round(fraction * 100)} % Wasser gewechselt (${Math.round(liters)} L Leitungswasser, ${TAP.temp} °C kalt).`)
}

export function siphon(s: GameState) {
  const w = s.water
  const liters = w.volume * 0.05
  if (!spend(s, liters * PRICES.waterPerLiter)) return
  const removed = w.solids * 0.8
  w.solids -= removed
  const f = 0.05
  w.tan *= 1 - f
  w.no2 *= 1 - f
  w.no3 = w.no3 * (1 - f) + TAP.no3 * f
  w.kh = w.kh * (1 - f) + TAP.kh * f
  w.temp = w.temp * (1 - f) + TAP.temp * f
  w.salt *= 1 - f
  addLog(s, 'info', `Schlamm abgesaugt (${Math.round(removed)} g Futterreste und Kot entfernt).`)
}

export function addBuffer(s: GameState) {
  if (!spend(s, PRICES.buffer * dosesFactor(s))) return
  s.water.kh += 1
  addLog(s, 'info', 'Puffer (Kaliumcarbonat) zugegeben: Karbonathärte +1 °dKH.')
}

export function addIron(s: GameState) {
  if (!spend(s, PRICES.iron * dosesFactor(s))) return
  s.water.fe += 1
  addLog(s, 'info', 'Eisen-Chelat zugegeben: +1 mg/L Eisen.')
}

export function addAmmonia(s: GameState) {
  if (!spend(s, PRICES.ammonia * dosesFactor(s))) return
  s.water.tan += 2
  addLog(s, 'info', 'Ammoniumchlorid zugegeben (+2 mg/L). Damit füttert man die Bakterien beim Einfahren ohne Fische.')
}

export function addStarter(s: GameState) {
  if (!spend(s, PRICES.starter)) return
  s.aob += 3
  s.nob += 2.5
  addLog(s, 'info', 'Bakterienstarter zugegeben. Das Einfahren geht jetzt schneller.')
}

export function addSalt(s: GameState) {
  if (s.water.salt >= 6) {
    addLog(s, 'warn', 'Mehr Salz verträgt die Anlage nicht. Schon ab 2 g/L leiden die Pflanzen.')
    return
  }
  if (!spend(s, PRICES.saltKg * dosesFactor(s))) return
  s.water.salt += 1
  addLog(
    s,
    'info',
    `Salz zugegeben, jetzt ${s.water.salt.toFixed(1)} g/L. Ab 2 g/L heilt Weißpünktchen ab und Nitrit wird weniger giftig. Den Pflanzen schadet es auf Dauer, später Wasser wechseln.`,
  )
}

/** Radialabscheider entleeren: in den Mineralisierer, sonst auf den Kompost */
export function emptySludge(s: GameState) {
  const w = s.water
  if (w.sludge < 1) return
  const g = w.sludge
  w.sludge = 0
  if (s.equip.mineralizer) {
    w.mineral += g
    addLog(s, 'info', `${Math.round(g)} g Schlamm in den Mineralisierer gegeben. Daraus werden Nährstoffe für die Pflanzen.`)
  } else addLog(s, 'info', `${Math.round(g)} g Schlamm abgelassen (auf den Kompost).`)
}

// --- Fische ---

export function buyFish(s: GameState, species: FishId, count: number) {
  const sp = FISH[species]
  if (!spend(s, sp.priceFingerling * count)) return
  const g: FishGroup = {
    id: s.nextId++,
    species,
    count,
    weight: sp.startWeight,
    health: 90,
    stomach: 0,
    hoursHungry: 0,
    deathAcc: 0,
    // Neue Fische bringen manchmal Krankheiten mit
    disease: Math.random() < 0.12 ? 0.03 : 0,
  }
  s.fish.push(g)
  addLog(s, 'info', `${count} junge ${sp.name} (je ${sp.startWeight} g) eingesetzt.`)
}

export function fishValue(g: FishGroup) {
  const sp = FISH[g.species]
  const sizeF = g.weight >= sp.harvestWeight ? 1 : 0.3 + (0.7 * g.weight) / sp.harvestWeight
  return ((g.count * g.weight) / 1000) * sp.pricePerKg * sizeF * (0.5 + g.health / 200)
}

export function sellFish(s: GameState, id: number) {
  const g = s.fish.find((x) => x.id === id)
  if (!g) return
  const v = fishValue(g)
  earn(s, v)
  s.stats.fishSold += g.count
  s.fish = s.fish.filter((x) => x !== g)
  addLog(s, 'good', `${g.count} ${FISH[g.species].name} (${((g.count * g.weight) / 1000).toFixed(1)} kg) für ${v.toFixed(2)} € verkauft.`)
}

export function removeDead(s: GameState) {
  const w = s.water
  if (!w.deadCount) return
  addLog(s, 'info', `${w.deadCount} tote Fische entfernt.`)
  w.deadCount = 0
  w.deadMass = 0
}

// --- Pflanzen ---

export function plantSeedling(s: GameState, slot: number, species: PlantId) {
  if (s.slots[slot]) return
  const sp = PLANTS[species]
  if (!spend(s, sp.priceSeedling)) return
  const p: Plant = {
    id: s.nextId++,
    species,
    ageH: 0,
    mass: sp.startMass,
    fruit: 0,
    health: 95,
    chlorosis: 0,
    nDeficit: 0,
    dead: false,
  }
  s.slots[slot] = p
}

export function plantValue(p: Plant) {
  const sp = PLANTS[p.species]
  if (p.dead) return 0
  const quality = (0.4 + (0.6 * p.health) / 100) * (1 - p.chlorosis * 0.5) * (1 - p.nDeficit * 0.3)
  if (sp.fruiting) return (p.fruit / 1000) * sp.price * quality
  const size = Math.min(1, p.mass / sp.harvestMass)
  const old = p.ageH / 24 > sp.days * 1.8 ? 0.6 : 1
  return sp.price * Math.pow(size, 1.5) * quality * old
}

/** Ernten: Blattgemüse wird komplett geerntet, Tomaten nur die Früchte */
export function harvest(s: GameState, slot: number) {
  const p = s.slots[slot]
  if (!p) return
  const sp = PLANTS[p.species]
  if (p.dead) {
    s.slots[slot] = null
    addLog(s, 'info', `Eingegangene Pflanze (${sp.name}) entfernt.`)
    return
  }
  const v = plantValue(p)
  earn(s, v)
  if (sp.fruiting) {
    addLog(s, 'good', `${(p.fruit / 1000).toFixed(2)} kg Tomaten geerntet: ${v.toFixed(2)} €.`)
    p.fruit = 0
  } else {
    s.stats.plantsHarvested += 1
    s.slots[slot] = null
    addLog(s, 'good', `${sp.name} geerntet (${Math.round(p.mass)} g): ${v.toFixed(2)} €.`)
  }
}

export function releaseBeneficials(s: GameState) {
  if (!spend(s, PRICES.beneficials)) return
  s.beneficials = 1
  addLog(s, 'info', 'Florfliegen- und Schlupfwespen-Larven ausgebracht. Sie fressen die Blattläuse, ganz ohne Gift.')
}

export function removePlant(s: GameState, slot: number) {
  s.slots[slot] = null
}

// --- Technik ---

export function buyFeed(s: GameState, kg: number) {
  if (!spend(s, PRICES.feedKg * kg)) return
  s.feedStock += kg * 1000
  addLog(s, 'info', `${kg} kg Fischfutter gekauft.`)
}

export function buyTests(s: GameState) {
  if (!spend(s, PRICES.testKit)) return
  s.tests += 20
  addLog(s, 'info', 'Neues Testset mit 20 Messungen gekauft.')
}

export function upgradeAirPump(s: GameState) {
  const next = s.equip.airPump + 1
  if (next >= PRICES.airPump.length) return
  if (!spend(s, PRICES.airPump[next])) return
  s.equip.airPump = next
  addLog(s, 'info', `Luftpumpe auf Stufe ${next} verbessert.`)
}

export function buyHeater(s: GameState) {
  if (s.equip.heater || !spend(s, PRICES.heater)) return
  s.equip.heater = true
  s.equip.heaterOn = true
  addLog(s, 'info', 'Heizstab (300 W) eingebaut.')
}

export function buyAutoFeeder(s: GameState) {
  if (s.equip.autoFeeder || !spend(s, PRICES.autoFeeder)) return
  s.equip.autoFeeder = true
  s.equip.autoFeederOn = true
  addLog(s, 'info', 'Futterautomat eingebaut. Er füttert um 8, 13 und 18 Uhr.')
}

export function buyProbes(s: GameState) {
  if (s.equip.probes || !spend(s, PRICES.probes)) return
  s.equip.probes = true
  addLog(s, 'info', 'Messsonden eingebaut: Die Wasserwerte werden jetzt laufend angezeigt.')
}

export function buyBed(s: GameState) {
  if (s.equip.beds >= MAX_BEDS || !spend(s, PRICES.bed)) return
  s.equip.beds += 1
  for (let i = 0; i < SLOTS_PER_BED; i++) s.slots.push(null)
  addLog(s, 'info', `Neues Pflanzbeet gebaut (jetzt ${s.equip.beds}).`)
}

export function upgradeTank(s: GameState) {
  const next = s.equip.tankLevel + 1
  if (next >= TANK_SIZES.length) return
  if (!spend(s, PRICES.tank[next])) return
  const w = s.water
  const oldV = w.volume
  const newV = TANK_SIZES[next]
  const keep = oldV / newV
  const add = 1 - keep
  w.tan *= keep
  w.no2 *= keep
  w.no3 = w.no3 * keep + TAP.no3 * add
  w.kh = w.kh * keep + TAP.kh * add
  w.fe = w.fe * keep + TAP.fe * add
  w.temp = w.temp * keep + TAP.temp * add
  w.volume = newV
  s.equip.tankLevel = next
  addLog(s, 'info', `Weitere Fischbecken, jetzt ${newV} L. Mehr Wasser macht die Werte stabiler.`)
}

// --- Profi-Technik ---

export type EquipItem =
  | 'degasser'
  | 'uv'
  | 'oxygen'
  | 'generator'
  | 'batteryAir'
  | 'mineralizer'
  | 'doser'
  | 'airHeater'
  | 'climate'
  | 'led'
  | 'insectNet'

const EQUIP_LOG: Record<EquipItem, string> = {
  degasser: 'Rieselturm zum Entgasen eingebaut. Er treibt CO₂ aus, dadurch steigt der pH-Wert, und bringt Sauerstoff ein.',
  uv: 'UV-Klärer eingebaut. Er tötet Keime und Schwebealgen im Wasser ab.',
  oxygen: 'Sauerstoffkonzentrator mit Diffusor eingebaut. Damit vertragen die Becken deutlich mehr Fische.',
  generator: 'Notstromaggregat aufgestellt. Bei Stromausfall springt es automatisch an.',
  batteryAir: 'Akku-Luftpumpe angeschlossen. Sie hält bei Stromausfall die Belüftung am Laufen.',
  mineralizer: 'Mineralisierungstank aufgestellt. Bakterien machen aus dem Fischschlamm Pflanzendünger.',
  doser: 'Dosierstation eingebaut. Sie hält Karbonathärte und Eisen automatisch auf dem Sollwert.',
  airHeater: 'Gas-Warmluftheizer im Gewächshaus montiert. Hält die Luft im Winter frostfrei.',
  climate: 'Klimasteuerung mit Lüftungsklappen, Ventilatoren und Schattiernetz eingebaut.',
  led: 'LED-Pflanzenlampen über den Beeten montiert. Sie verlängern im Winter den Tag.',
  insectNet: 'Insektenschutznetz an Tür und Lüftung gespannt. Es kommen viel weniger Schädlinge rein.',
}

export function buyEquip(s: GameState, item: EquipItem) {
  if (s.equip[item] || !spend(s, PRICES[item])) return
  s.equip[item] = true
  addLog(s, 'info', EQUIP_LOG[item])
}

export function upgradeMechFilter(s: GameState) {
  const next = s.equip.mechFilter + 1
  if (next >= PRICES.mechFilter.length) return
  if (!spend(s, PRICES.mechFilter[next])) return
  s.equip.mechFilter = next
  addLog(
    s,
    'info',
    next === 1
      ? 'Radialabscheider eingebaut. Er holt Kot und Futterreste aus dem Wasser. Den Schlamm musst du ab und zu ablassen.'
      : 'Trommelfilter eingebaut. Er siebt Feststoffe fein heraus und spült sie selbst aus.',
  )
}

export function buyMbbr(s: GameState) {
  if (s.equip.mbbr >= MAX_MBBR || !spend(s, PRICES.mbbr)) return
  s.equip.mbbr += 1
  addLog(
    s,
    'info',
    `MBBR-Biofilter ${s.equip.mbbr} eingebaut. Auf den wirbelnden Kunststoffkörpern wachsen viel mehr Bakterien. Sie müssen sich aber erst ansiedeln.`,
  )
}
