import { airTemp, clamp, daylight, dayOfYear, nh3Fraction, o2Saturation, phOf, tempFactor } from './chemistry.ts'
import { AIR_KLA, AIR_WATT, FISH, PLANTS, PRICES, SLUDGE_CAP, TAP, type PlantSpecies } from './data.ts'
import type { FishGroup, GameState, Live, LogKind, Reading } from './state.ts'

/** Simulationsschritt in Spielstunden */
export const DT = 1 / 12

const MEALS = [8, 13, 18]

/** Mittlere wirksame Lichtstunden pro Tag (Sinusverlauf über ~14 h) */
const LIGHT_HOURS_PER_DAY = 9

export function plantMaxMass(sp: PlantSpecies) {
  return sp.harvestMass * 1.5
}

const rateCache = new Map<string, number>()
/** Logistische Wachstumsrate so, dass das Erntegewicht nach `days` Idealtagen erreicht ist */
export function plantGrowthRate(sp: PlantSpecies) {
  let r = rateCache.get(sp.id)
  if (r === undefined) {
    const max = plantMaxMass(sp)
    const h = sp.harvestMass
    const m0 = sp.startMass
    r = Math.log(h / (max - h) / (m0 / (max - m0))) / (sp.days * LIGHT_HOURS_PER_DAY)
    rateCache.set(sp.id, r)
  }
  return r
}

export function fishDailyRation(g: FishGroup) {
  return FISH[g.species].appetite * Math.pow(g.weight, 0.75) * g.count
}

export function biomassKg(s: GameState) {
  return s.fish.reduce((a, g) => a + (g.count * g.weight) / 1000, 0)
}

export function currentPh(s: GameState) {
  return phOf(s.water.kh, s.water.co2)
}

/** Lufttemperatur im Gewächshaus (mit Heizung und Lüftung) */
export function currentAir(s: GameState) {
  return climate(s).air
}

export function currentLight(s: GameState) {
  return daylight(dayOfYear(s.startDoy, s.t), s.t % 24)
}

/** Ist Strom da? (Netz oder Notstromaggregat) */
export function hasPower(s: GameState) {
  return s.outage <= 0 || s.equip.generator
}

/** Wirksame Stufe der Belüftung (bei Stromausfall nur die Akku-Pumpe) */
export function aeration(s: GameState) {
  const e = s.equip
  return hasPower(s) ? e.airPump : e.batteryAir ? Math.min(1, e.airPump) || 1 : 0
}

/** Gewächshausklima: Heizung, Lüftung/Schattierung und Pflanzenlicht */
export function climate(s: GameState): Live {
  const e = s.equip
  const hour = s.t % 24
  const doy = dayOfYear(s.startDoy, s.t)
  const power = hasPower(s)
  let air = airTemp(doy, hour)
  let light = daylight(doy, hour)
  let airHeating = false
  let venting = false
  let shading = false
  if (e.airHeater && e.airHeaterOn && power && air < e.airHeaterSet) {
    air = e.airHeaterSet
    airHeating = true
  }
  if (e.climate && power && air > 24) {
    air = 24 + (air - 24) * 0.45
    venting = true
    if (light > 0.7) {
      light *= 0.8
      air -= 1.5
      shading = true
    }
  }
  let plantLight = light
  const ledActive = e.led && e.ledOn && power && hour >= 5 && hour < 22 && light < 0.5
  if (ledActive) plantLight = 0.5
  return { air, light, plantLight, power, airHeating, venting, shading, ledActive, watts: 0 }
}

/** Klima-Anzeige sofort aktualisieren (nach Laden oder Umschalten, auch im Pausenmodus) */
export function refreshLive(s: GameState) {
  s.live = { ...climate(s), watts: s.live?.watts ?? 0 }
  return s
}

/** Kapazität der Bakterien (mg N/h): kleiner Grundfilter, Wurzeln in den Beeten, MBBR-Module */
export function bioCapacity(s: GameState) {
  return 150 + 60 * s.equip.beds + 1500 * s.equip.mbbr
}

export function snapshot(s: GameState): Reading {
  const w = s.water
  const ph = currentPh(s)
  return {
    t: s.t,
    temp: w.temp,
    tan: w.tan,
    nh3: w.tan * nh3Fraction(ph, w.temp),
    no2: w.no2,
    no3: w.no3,
    ph,
    kh: w.kh,
    o2: w.o2,
    fe: w.fe,
  }
}

export function addLog(s: GameState, kind: LogKind, text: string) {
  s.log.push({ t: s.t, kind, text })
  s.flags._seq = (s.flags._seq ?? 0) + 1
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300)
}

/** Meldung höchstens alle `everyH` Stunden */
function notify(s: GameState, key: string, everyH: number, kind: LogKind, text: string) {
  const last = s.flags[key]
  if (last !== undefined && s.t - last < everyH) return
  s.flags[key] = s.t
  addLog(s, kind, text)
}

export function pay(s: GameState, amount: number) {
  s.money -= amount
  s.stats.spent += amount
}

/** Spiel um `hours` Stunden weiterlaufen lassen */
export function advance(s: GameState, hours: number) {
  let left = hours
  while (left > 1e-9) {
    const dt = Math.min(DT, left)
    step(s, dt)
    left -= dt
  }
}

export function step(s: GameState, dt: number) {
  const w = s.water
  const V = w.volume
  const scale = 1000 / V
  const e = s.equip
  const ph = phOf(w.kh, w.co2)

  // --- Stromausfall ---
  if (s.outage > 0) {
    s.outage -= dt
    if (s.outage <= 0) {
      s.outage = 0
      addLog(s, 'good', 'Der Strom ist wieder da.')
    }
  } else if (s.t > 24 * 45 && Math.random() < dt / (24 * 70)) {
    s.outage = 1 + Math.random() * 5
    addLog(
      s,
      e.generator ? 'warn' : 'bad',
      e.generator
        ? 'Stromausfall! Das Notstromaggregat ist angesprungen und hält alles am Laufen.'
        : e.batteryAir
          ? 'Stromausfall! Die Pumpe steht, nur die Akku-Luftpumpe sprudelt noch.'
          : 'Stromausfall! Pumpen und Belüftung stehen still. Der Sauerstoff im Wasser sinkt.',
    )
  }
  const live = climate(s)
  s.live = live
  const power = live.power
  const air = live.air
  const light = live.plantLight
  const pump = e.pumpOn && power
  const airLevel = aeration(s)

  let tanMg = 0
  let o2Mg = 0
  let co2Mg = 0
  let watts = 0

  // --- Temperatur und Strom ---
  w.temp += (air - w.temp) * 0.03 * Math.sqrt(scale) * dt
  if (e.heater && e.heaterOn && power && w.temp < e.heaterSet) {
    w.temp = Math.min(e.heaterSet, w.temp + 0.6 * scale * dt)
    watts += 300
  }
  if (pump) watts += 40 * Math.sqrt(V / 1000)
  watts += AIR_WATT[airLevel] * Math.sqrt(V / 1000)
  if (power) {
    if (e.mechFilter === 2 && pump) watts += 60
    watts += 40 * e.mbbr
    if (e.degasser) watts += 20
    if (e.uv) watts += 40
    if (e.oxygen && e.oxygenOn) watts += 350
    if (e.mineralizer) watts += 10
    if (live.venting) watts += 150
    if (live.ledActive) watts += 150 * e.beds
  }
  live.watts = watts
  const kWh = (watts / 1000) * dt
  s.energyKWh += kWh
  if (s.outage > 0 && e.generator) pay(s, PRICES.generatorHour * dt)
  else pay(s, kWh * PRICES.kWh)
  if (live.airHeating) {
    const outside = airTemp(dayOfYear(s.startDoy, s.t), s.t % 24)
    pay(s, (e.airHeaterSet - outside) * 0.5 * (0.6 + 0.4 * e.beds) * PRICES.gasKWh * dt)
  }

  // --- Futterautomat ---
  if (e.autoFeeder && e.autoFeederOn && s.fish.length) {
    for (const m of MEALS) {
      if (Math.floor((s.t - m) / 24) < Math.floor((s.t + dt - m) / 24)) {
        const grams = (biomassKg(s) * 1000 * e.autoFeedRate) / 100 / MEALS.length
        dropFeed(s, grams)
      }
    }
  }

  // --- Fische fressen ---
  const appetiteF = s.fish.map((g) => {
    const sp = FISH[g.species]
    const fT = tempFactor(w.temp, sp.tMin, sp.optMin, sp.optMax, sp.tMax)
    const fO = clamp((w.o2 - sp.doMin * 0.5) / (sp.doMin * 0.7 + 0.5))
    return fT * fO * (0.3 + (0.7 * g.health) / 100)
  })
  const free = s.fish.map((g, i) => Math.max(0, fishDailyRation(g) * 0.45 * appetiteF[i] - g.stomach))
  const freeSum = free.reduce((a, b) => a + b, 0)
  if (w.floatingFeed > 0) {
    const eaten = Math.min(w.floatingFeed, freeSum * (1 - Math.exp(-6 * dt)))
    if (eaten > 0) {
      s.fish.forEach((g, i) => (g.stomach += (eaten * free[i]) / freeSum))
      w.floatingFeed -= eaten
    }
    const sunk = w.floatingFeed * (1 - Math.exp(-1.2 * dt))
    w.floatingFeed -= sunk
    w.solids += sunk
    if (w.floatingFeed < 0.01) {
      w.solids += w.floatingFeed
      w.floatingFeed = 0
    }
  }

  // --- Verdauung, Wachstum, Stress ---
  const nh3 = w.tan * nh3Fraction(ph, w.temp)
  for (const g of s.fish) {
    const sp = FISH[g.species]
    const fT = tempFactor(w.temp, sp.tMin, sp.optMin, sp.optMax, sp.tMax)
    const daily = fishDailyRation(g)
    const d = Math.min(g.stomach, (daily / 24) * Math.max(fT, 0.2) * dt)
    g.stomach -= d
    if (d > 0) {
      const growthF = g.health > 50 ? 1 : g.health / 50
      g.weight = Math.min(sp.maxWeight, g.weight + ((d / sp.fcr) * growthF) / g.count)
      tanMg += d * 32
      o2Mg += d * 200
      co2Mg += d * 200 * 1.375
      w.solids += d * 0.25
      w.fe += (d * 0.05) / V
    }
    const kg = (g.count * g.weight) / 1000
    const basal = kg * 130 * Math.pow(1.06, w.temp - 22) * dt
    o2Mg += basal
    co2Mg += basal * 1.375
    g.hoursHungry = g.stomach < daily * 0.02 ? g.hoursHungry + dt : 0

    let stress = 0
    stress += Math.max(0, nh3 - 0.05) * 4 * sp.sensitivity
    // Chlorid aus Kochsalz schützt die Kiemen vor Nitrit
    stress += (Math.max(0, w.no2 - 1) * 0.12 * sp.sensitivity) / (1 + w.salt * 1.5)
    stress += Math.max(0, w.no3 - 150) * 0.01
    stress += Math.max(0, sp.doMin - w.o2) * 3
    if (w.temp < sp.tMin) stress += (sp.tMin - w.temp) * 3
    else if (w.temp > sp.tMax) stress += (w.temp - sp.tMax) * 3
    else if (w.temp < sp.optMin - 4 || w.temp > sp.optMax + 2) stress += 0.05
    if (ph < 6) stress += (6 - ph) * 3
    if (ph > 9) stress += (ph - 9) * 3
    stress += Math.max(0, w.co2 - 25) * 0.1
    if (g.hoursHungry > 72) stress += 0.1
    if (w.salt > 6) stress += (w.salt - 6) * 0.3

    // Weißpünktchenkrankheit: Stress, Enge und neue Fische machen anfällig, UV und Salz helfen
    if (g.disease > 0) {
      const cure = w.salt >= 2 ? 0.015 : g.health > 85 ? 0.001 : 0
      g.disease = clamp(g.disease + (0.006 * (1 + stress * 3) * (w.temp > 18 ? 1 : 0.5) * (e.uv && power ? 0.6 : 1) - cure) * dt)
      if (g.disease > 0.25)
        notify(s, `ich-${g.id}`, 48, 'warn', `Die ${sp.name} haben weiße Pünktchen und scheuern sich am Beckenrand. Eine Salzbehandlung mit 2–3 g/L hilft.`)
      if (g.disease <= 0) {
        g.disease = 0
        if (s.flags[`ich-${g.id}`] !== undefined) addLog(s, 'good', `Die ${sp.name} sind wieder gesund.`)
        delete s.flags[`ich-${g.id}`]
      }
      stress += g.disease * 1.2
    } else {
      const density = (biomassKg(s) / V) * 1000
      const risk = 0.00003 * (1 + stress * 30) * (1 + density / 30) * (e.uv && power ? 0.25 : 1)
      if (Math.random() < risk * dt) g.disease = 0.02
    }
    g.health = clamp(g.health + (0.5 * (1 - Math.min(1, stress * 4)) - stress) * dt, 0, 100)

    if (g.health < 35) {
      const rate = g.health <= 0 ? 0.1 : ((35 - g.health) / 35) * 0.03
      g.deathAcc += g.count * rate * dt
      let died = 0
      while (g.deathAcc >= 1 && g.count > 0) {
        g.deathAcc -= 1
        g.count -= 1
        died++
        w.deadCount += 1
        w.deadMass += g.weight
        s.stats.fishDied += 1
      }
      if (died) {
        const visible = s.flags['deadmsg']
        if (visible !== undefined && s.t - visible < 6 && s.log.length) {
          const last = s.log[s.log.length - 1]
          const m = /^(\d+) toter? /.exec(last.text)
          if (m && last.kind === 'bad') {
            const n = Number(m[1]) + died
            last.text = `${n} tote Fische im Tank! Entferne sie schnell, verwesende Fische vergiften das Wasser.`
            continue
          }
        }
        s.flags['deadmsg'] = s.t
        addLog(
          s,
          'bad',
          `${died} ${died === 1 ? 'toter Fisch' : 'tote Fische'} im Tank! Entferne sie schnell, verwesende Fische vergiften das Wasser.`,
        )
      }
    }
  }
  s.fish = s.fish.filter((g) => g.count > 0)

  // --- Zersetzung ---
  const decayT = Math.pow(1.07, w.temp - 20)
  if (w.solids > 0) {
    const dec = w.solids * 0.015 * decayT * dt
    w.solids -= dec
    tanMg += dec * 20
    o2Mg += dec * 800
    co2Mg += dec * 1100
  }
  if (w.deadMass > 0) {
    const dec = w.deadMass * 0.03 * decayT * dt
    w.deadMass -= dec
    tanMg += dec * 25
    o2Mg += dec * 1000
    co2Mg += dec * 1375
    if (w.deadMass < 1) {
      w.deadMass = 0
      w.deadCount = 0
    }
  }
  // --- Mechanische Filterung und Mineralisierung ---
  const toMineral = (g: number) => {
    if (e.mineralizer) w.mineral += g
  }
  let backwashL = 0
  if (pump && e.mechFilter > 0 && w.solids > 0) {
    if (e.mechFilter === 2) {
      const removed = w.solids * 0.35 * dt
      w.solids -= removed
      toMineral(removed)
      backwashL = V * (0.01 / 24) * dt
    } else {
      const removed = w.solids * 0.18 * (w.sludge < SLUDGE_CAP ? 1 : 0.1) * dt
      w.solids -= removed
      w.sludge += removed
      if (w.sludge > SLUDGE_CAP * 0.8) notify(s, 'sludge', 48, 'warn', 'Der Radialabscheider ist fast voll. Entleere den Schlamm, sonst fault er.')
    }
  }
  if (w.sludge > 0) {
    // Schlamm im Abscheider fault langsam und gibt Ammonium ab
    const dec = w.sludge * 0.003 * decayT * dt
    w.sludge -= dec
    tanMg += dec * 20
    o2Mg += dec * 300
  }
  if (w.mineral > 0 && power) {
    // Belüfteter Mineralisierungstank: Schlamm wird zu Pflanzennährstoffen
    const dec = w.mineral * 0.012 * dt
    w.mineral -= dec
    w.no3 += (dec * 25) / V
    w.fe += (dec * 0.4) / V
  }
  w.tan += tanMg / V

  // --- Nitrifikation ---
  const fTb = w.temp <= 30 ? Math.min(1, Math.pow(1.06, w.temp - 28)) : clamp(1 - (w.temp - 30) * 0.12, 0.1, 1)
  const fPh = ph < 7.5 ? clamp(1 - (7.5 - ph) * 0.45, 0.03, 1) : ph > 8.6 ? clamp(1 - (ph - 8.6) * 0.8, 0.1, 1) : 1
  const fDo = w.o2 / (1 + w.o2)
  const flow = pump ? 1 : e.mbbr && power ? 0.4 : 0.15
  const env = fTb * fPh * fDo * flow
  let rA = s.aob * (w.tan / (0.7 + w.tan)) * env
  rA = Math.min(rA, (w.tan * V) / dt)
  w.tan -= (rA * dt) / V
  w.no2 += (rA * dt) / V
  const fFa = 1 / (1 + nh3 / 0.25)
  let rN = s.nob * (w.no2 / (0.4 + w.no2)) * env * fFa
  rN = Math.min(rN, (w.no2 * V) / dt)
  w.no2 -= (rN * dt) / V
  w.no3 += (rN * dt) / V
  o2Mg += (rA * 3.43 + rN * 1.14) * dt
  w.kh = Math.max(0, w.kh - ((rA * dt) / V) * 0.4)
  const cap = bioCapacity(s)
  s.aob = clamp(s.aob + (0.045 * rA - 0.003 * s.aob) * dt, 0.02, cap)
  s.nob = clamp(s.nob + (0.045 * rN - 0.002 * s.nob) * dt, 0.02, cap)

  // --- Schädlinge: Blattläuse vermehren sich bei Wärme, Nützlinge fressen sie ---
  const hasPlants = s.slots.some((p) => p && !p.dead)
  const warm = clamp((air - 12) / 10)
  if (hasPlants && s.pests < 0.02 && Math.random() < dt * 0.0008 * warm * (e.insectNet ? 0.2 : 1)) s.pests = 0.03
  s.pests = clamp(s.pests + (0.006 * s.pests * (1 - s.pests) * warm * (hasPlants ? 1 : -3) - 0.03 * s.beneficials * s.pests) * dt)
  if (s.pests < 0.005) s.pests = 0
  s.beneficials = Math.max(0, s.beneficials - 0.002 * dt)
  if (s.pests > 0.25)
    notify(s, 'pests', 72, 'warn', 'Blattläuse breiten sich auf den Pflanzen aus! Setze Nützlinge ein. Gift ist tabu, es würde die Fische töten.')

  // --- Pflanzen ---
  s.dryHours = pump ? 0 : s.dryHours + dt
  const wet = s.dryHours < 3
  const feAvail = (w.fe / (0.25 + w.fe)) * (ph <= 6.8 ? 1 : Math.max(0.15, 1 - (ph - 6.8) * 0.55))
  const fFe = 0.3 + 0.7 * Math.min(1, feAvail * 1.4)
  let transpL = 0
  for (let i = 0; i < s.slots.length; i++) {
    const p = s.slots[i]
    if (!p || p.dead) continue
    const sp = PLANTS[p.species]
    p.ageH += dt
    const fT = tempFactor(air, sp.tMin, sp.optMin, sp.optMax, sp.tMax)
    const nAvail = w.no3 + 0.5 * w.tan
    const fN = nAvail / (nAvail + 3)
    // Liebigsches Minimumgesetz: Der knappste Faktor bremst das Wachstum
    const common = light * Math.min(fT, fN, fFe) * (p.health / 100) * (wet ? 1 : 0) * (1 - s.pests * 0.5)
    let dM = plantGrowthRate(sp) * p.mass * (1 - p.mass / plantMaxMass(sp)) * common * dt
    let dF = 0
    if (sp.fruiting && p.ageH / 24 > sp.fruiting.startDay) dF = sp.fruiting.gramsPerLightHour * common * dt
    // Stickstoff begrenzt das Wachstum
    const needMg = dM * sp.nContent + dF * 1.5
    const haveMg = (w.no3 + w.tan) * V
    if (needMg > haveMg && needMg > 0) {
      const f = haveMg / needMg
      dM *= f
      dF *= f
    }
    const nMg = dM * sp.nContent + dF * 1.5
    const fromNo3 = Math.min(nMg, w.no3 * V)
    w.no3 -= fromNo3 / V
    w.tan = Math.max(0, w.tan - (nMg - fromNo3) / V)
    w.kh += (fromNo3 / V) * 0.2
    w.fe = Math.max(0, w.fe - ((dM + dF) * 0.01) / V)
    p.mass += dM
    p.fruit += dF
    transpL += p.mass * 0.000035 * (0.3 + 1.2 * light) * dt

    p.chlorosis += ((1 - feAvail) * 0.9 - p.chlorosis) * 0.01 * dt
    p.nDeficit += (clamp((0.7 - fN) / 0.7) - p.nDeficit) * 0.01 * dt

    let stress = 0
    if (air < sp.tMin) stress += (sp.tMin - air) * 0.6
    if (air > sp.tMax) stress += (air - sp.tMax) * 0.6
    if (!wet) stress += 2
    if (ph < 5.5) stress += (5.5 - ph) * 0.5
    if (ph > 8.5) stress += (ph - 8.5) * 0.5
    if (pump && w.o2 < 2) stress += 0.3
    if (s.pests > 0.4) stress += (s.pests - 0.4) * 0.5
    if (w.salt > 2) stress += (w.salt - 2) * 0.3
    p.health = clamp(p.health + (stress > 0 ? -stress : 0.3) * dt, 0, 100)
    if (p.health <= 0) {
      p.dead = true
      addLog(s, 'bad', `Ein${sp.id === 'salat' || sp.id === 'basilikum' || sp.id === 'mangold' ? '' : 'e'} ${sp.name} ist eingegangen.`)
      continue
    }
    if (p.mass >= sp.harvestMass && !s.flags[`ripe${p.id}`]) {
      s.flags[`ripe${p.id}`] = s.t
      addLog(s, 'good', `${sp.name} ist erntereif.`)
    }
    if (p.chlorosis > 0.45) notify(s, 'chlorosis', 72, 'warn', 'Einige Pflanzen bekommen gelbe Blätter mit grünen Adern. Das deutet auf Eisenmangel hin.')
    if (p.nDeficit > 0.5) notify(s, 'ndef', 72, 'warn', 'Die Pflanzen werden blass und wachsen langsam. Es fehlt an Nährstoffen (Nitrat).')
  }
  if (!wet) notify(s, 'dry', 24, 'bad', 'Die Pumpe steht still: Das Pflanzbeet trocknet aus und die Pflanzen welken!')

  // --- Gasaustausch ---
  const extra = power ? 0.15 * e.mbbr + (e.degasser ? 0.15 : 0) : 0
  const kla = ((pump ? 0.15 : 0.03) + AIR_KLA[airLevel] + extra) * Math.sqrt(scale)
  const klaCo2 = kla * 0.5 + (e.degasser && pump ? 0.9 * Math.sqrt(scale) : 0)
  const sat = o2Saturation(w.temp)
  w.o2 = clamp(w.o2 + (sat - w.o2) * Math.min(1, kla * dt) - o2Mg / V, 0, 20)
  if (e.oxygen && e.oxygenOn && power) w.o2 += Math.min((12000 * dt) / V, Math.max(0, sat * 1.6 - w.o2))
  w.co2 = Math.max(0.3, w.co2 + co2Mg / V + (1 - w.co2) * Math.min(1, klaCo2 * dt))

  // --- Dosieranlage ---
  if (e.doser && e.doserOn && power) {
    const dose = V / 1000
    if (w.kh < e.doserKh) {
      w.kh += 0.5 * dt
      pay(s, PRICES.buffer * dose * 0.5 * dt)
    }
    if (w.fe < e.doserFe) {
      w.fe += 0.2 * dt
      pay(s, PRICES.iron * dose * 0.2 * dt)
    }
  }

  // --- Verdunstung, automatisches Nachfüllen mit Leitungswasser ---
  const evapL = V * (0.004 / 24) * dt * (1 + Math.max(0, air - 15) * 0.03) + transpL + backwashL
  const r = evapL / V
  w.kh += TAP.kh * r
  w.no3 += TAP.no3 * r
  w.fe += TAP.fe * r
  w.temp += (TAP.temp - w.temp) * r
  pay(s, evapL * PRICES.waterPerLiter)

  // Eisen fällt bei hohem pH aus, etwas Nitrat wird in sauerstoffarmen Ecken abgebaut
  w.fe = Math.max(0, w.fe - w.fe * 0.0015 * (ph > 7 ? 1 + (ph - 7) * 2 : 1) * dt)
  w.no3 = Math.max(0, w.no3 - w.no3 * 0.0003 * (1 + w.solids / 2000) * dt)

  // --- Sichtbare Warnzeichen ---
  if (s.fish.length && w.o2 < 2.5) notify(s, 'gasp', 12, 'bad', 'Die Fische schnappen an der Oberfläche nach Luft! Zu wenig Sauerstoff.')
  for (const g of s.fish) {
    const sp = FISH[g.species]
    if (w.temp < sp.optMin - 3) notify(s, `cold-${sp.id}`, 48, 'warn', `Das Wasser ist zu kalt für ${sp.name} (${w.temp.toFixed(1)} °C). Die Fische fressen kaum noch.`)
    if (w.temp > sp.optMax + 2) notify(s, `hot-${sp.id}`, 48, 'warn', `Das Wasser ist zu warm für ${sp.name} (${w.temp.toFixed(1)} °C).`)
    if (g.health < 50) notify(s, `sick-${g.id}`, 24, 'warn', `Die ${sp.name} wirken matt und krank. Prüfe die Wasserwerte!`)
  }
  if (s.outage > 0 && !e.generator && s.fish.length && w.o2 < 4)
    notify(s, 'outage-o2', 12, 'bad', 'Wegen des Stromausfalls wird der Sauerstoff knapp! Ein Notstromaggregat hätte das verhindert.')
  if (s.money < 0) notify(s, 'broke', 48, 'bad', 'Dein Konto ist im Minus! Verkaufe Ernte oder Fische.')

  // --- Messsonden ---
  if (e.probes) {
    const n = snapshot(s)
    if (n.nh3 > 0.05) notify(s, 'p-nh3', 24, 'warn', `Sonde: Giftiges Ammoniak ${n.nh3.toFixed(2)} mg/L. Weniger füttern oder Wasser wechseln.`)
    if (n.no2 > 1) notify(s, 'p-no2', 24, 'warn', `Sonde: Nitrit ${n.no2.toFixed(1)} mg/L.`)
    if (n.ph < 6.4) notify(s, 'p-ph', 24, 'warn', `Sonde: pH ${n.ph.toFixed(1)} sinkt. Puffer zugeben.`)
    if (Math.floor(s.t / 2) < Math.floor((s.t + dt) / 2)) {
      s.readings.push(n)
      if (s.readings.length > 3000) s.readings.splice(0, s.readings.length - 3000)
    }
  }

  s.t += dt
}

export function dropFeed(s: GameState, grams: number) {
  const g = Math.min(grams, s.feedStock)
  if (g <= 0) {
    notify(s, 'nofeed', 24, 'warn', 'Das Futter ist alle!')
    return 0
  }
  s.feedStock -= g
  s.water.floatingFeed += g
  s.stats.feedUsed += g
  if (s.feedStock < 300) notify(s, 'lowfeed', 48, 'warn', 'Der Futtervorrat geht zur Neige.')
  return g
}
