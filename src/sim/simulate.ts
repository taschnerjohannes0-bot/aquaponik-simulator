import { airTemp, clamp, daylight, dayOfYear, nh3Fraction, o2Saturation, phOf, tempFactor } from './chemistry.ts'
import { AIR_KLA, AIR_WATT, FISH, PLANTS, PRICES, TAP, type PlantSpecies } from './data.ts'
import type { FishGroup, GameState, LogKind, Reading } from './state.ts'

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

export function currentAir(s: GameState) {
  return airTemp(dayOfYear(s.startDoy, s.t), s.t % 24)
}

export function currentLight(s: GameState) {
  return daylight(dayOfYear(s.startDoy, s.t), s.t % 24)
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
  const hour = s.t % 24
  const doy = dayOfYear(s.startDoy, s.t)
  const air = airTemp(doy, hour)
  const light = daylight(doy, hour)
  const ph = phOf(w.kh, w.co2)
  const e = s.equip
  const pump = e.pumpOn

  let tanMg = 0
  let o2Mg = 0
  let co2Mg = 0
  let kWh = 0

  // --- Temperatur und Strom ---
  w.temp += (air - w.temp) * 0.03 * Math.sqrt(scale) * dt
  if (e.heater && e.heaterOn && w.temp < e.heaterSet) {
    w.temp = Math.min(e.heaterSet, w.temp + 0.6 * scale * dt)
    kWh += 0.3 * dt
  }
  if (pump) kWh += 0.04 * dt
  kWh += (AIR_WATT[e.airPump] / 1000) * dt
  if (kWh > 0) {
    s.energyKWh += kWh
    pay(s, kWh * PRICES.kWh)
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
    stress += Math.max(0, w.no2 - 1) * 0.12 * sp.sensitivity
    stress += Math.max(0, w.no3 - 150) * 0.01
    stress += Math.max(0, sp.doMin - w.o2) * 3
    if (w.temp < sp.tMin) stress += (sp.tMin - w.temp) * 3
    else if (w.temp > sp.tMax) stress += (w.temp - sp.tMax) * 3
    else if (w.temp < sp.optMin - 4 || w.temp > sp.optMax + 2) stress += 0.05
    if (ph < 6) stress += (6 - ph) * 3
    if (ph > 9) stress += (ph - 9) * 3
    stress += Math.max(0, w.co2 - 25) * 0.1
    if (g.hoursHungry > 72) stress += 0.1
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
  w.tan += tanMg / V

  // --- Nitrifikation ---
  const fTb = w.temp <= 30 ? Math.min(1, Math.pow(1.06, w.temp - 28)) : clamp(1 - (w.temp - 30) * 0.12, 0.1, 1)
  const fPh = ph < 7.5 ? clamp(1 - (7.5 - ph) * 0.45, 0.03, 1) : ph > 8.6 ? clamp(1 - (ph - 8.6) * 0.8, 0.1, 1) : 1
  const fDo = w.o2 / (1 + w.o2)
  const flow = pump ? 1 : 0.15
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
  const cap = e.beds * 1500 + 60 * (V / 1000)
  s.aob = clamp(s.aob + (0.045 * rA - 0.003 * s.aob) * dt, 0.02, cap)
  s.nob = clamp(s.nob + (0.045 * rN - 0.002 * s.nob) * dt, 0.02, cap)

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
    const common = light * Math.min(fT, fN, fFe) * (p.health / 100) * (wet ? 1 : 0)
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
  if (!wet) notify(s, 'dry', 24, 'bad', 'Die Pumpe ist aus: Das Pflanzbeet trocknet aus und die Pflanzen welken!')

  // --- Gasaustausch ---
  const kla = ((pump ? 0.15 : 0.03) + AIR_KLA[e.airPump]) * Math.sqrt(scale)
  const sat = o2Saturation(w.temp)
  w.o2 = clamp(w.o2 + (sat - w.o2) * Math.min(1, kla * dt) - o2Mg / V, 0, 20)
  w.co2 = Math.max(0.3, w.co2 + co2Mg / V + (1 - w.co2) * Math.min(1, kla * 0.5 * dt))

  // --- Verdunstung, automatisches Nachfüllen mit Leitungswasser ---
  const evapL = V * (0.004 / 24) * dt * (1 + Math.max(0, air - 15) * 0.03) + transpL
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
