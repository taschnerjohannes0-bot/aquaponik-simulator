// Spielt die Simulation ohne Oberfläche durch, um die Werte zu prüfen: npm run sim
import { buyEquip, buyFeed, addBuffer, addIron, buyFish, buyMbbr, harvest, plantSeedling, releaseBeneficials, waterChange } from '../src/sim/actions.ts'
import { PLANTS } from '../src/sim/data.ts'
import { advance, biomassKg, dropFeed, snapshot } from '../src/sim/simulate.ts'
import { newGame } from '../src/sim/state.ts'

const s = newGame()
const scenario = process.argv[2] ?? 'fish'
if (process.env.CYCLED) {
  s.aob = 80
  s.nob = 80
  s.startDoy = 150
}
if (scenario !== 'fishless') buyFish(s, 'karpfen', Number(process.argv[5] ?? 20))
for (let i = 0; i < 12; i++) plantSeedling(s, i, i % 2 ? 'salat' : 'mangold')

for (let day = 1; day <= Number(process.argv[4] ?? 90); day++) {
  if (scenario !== 'fishless') {
    for (const h of [0, 5, 10]) {
      advance(s, h === 0 ? 0 : 5)
      dropFeed(s, biomassKg(s) * 1000 * Number(process.env.FEED ?? 0.005))
      if (s.feedStock < 500) buyFeed(s, 5)
    }
    advance(s, 14)
  } else {
    if (snapshot(s).tan < 1) s.water.tan += 2
    advance(s, 24)
  }
  if (process.argv[3] === 'gut') {
    const r = snapshot(s)
    if (r.nh3 > 0.05 || r.no2 > 1.5) waterChange(s, 0.25)
    if (r.kh < 2) addBuffer(s)
    if (r.fe < 0.8) addIron(s)
    if (s.pests > 0.25 && s.beneficials < 0.3) releaseBeneficials(s)
    if (process.env.PRO && !s.equip.batteryAir) buyEquip(s, 'batteryAir')
    if (process.env.PRO && s.money > 450 && s.equip.mbbr < 1) buyMbbr(s)
    s.water.deadCount = 0
    s.water.deadMass = 0
    s.slots.forEach((p, i) => {
      if (!p) return s.money > 20 && plantSeedling(s, i, i % 2 ? 'salat' : 'mangold')
      if (p.dead || p.mass >= PLANTS[p.species].harvestMass) harvest(s, i)
    })
  }
  if (day % 3 === 0) {
    const r = snapshot(s)
    const plants = s.slots.filter(Boolean).map((p) => `${Math.round(p!.mass)}/${Math.round(p!.health)}`)
    console.log(
      `T${String(day).padStart(3)} ${r.temp.toFixed(1)}°C pH ${r.ph.toFixed(2)} KH ${r.kh.toFixed(1)} O2 ${r.o2.toFixed(1)} ` +
        `TAN ${r.tan.toFixed(2)} NH3 ${r.nh3.toFixed(3)} NO2 ${r.no2.toFixed(2)} NO3 ${r.no3.toFixed(1)} Fe ${r.fe.toFixed(2)} ` +
        `AOB ${s.aob.toFixed(1)} NOB ${s.nob.toFixed(1)} | Fische ${s.fish.map((g) => `${g.count}×${g.weight.toFixed(0)}g ${g.health.toFixed(0)}%`).join(' ')} ` +
        `| Pfl ${plants.join(',')} | € ${s.money.toFixed(0)}`,
    )
  }
}
for (const l of s.log) console.log(`[${(l.t / 24).toFixed(1)}] ${l.kind}: ${l.text}`)
