// Zeichnet die Anlage: Gewächshaus, Pflanzbeete, Rohre und den Fischtank mit Fischen.
import { clamp } from '../sim/chemistry.ts'
import { FISH, PLANTS, SLOTS_PER_BED } from '../sim/data.ts'
import { currentLight, plantMaxMass } from '../sim/simulate.ts'
import type { FishGroup, GameState, Plant } from '../sim/state.ts'

export const W = 800
export const H = 520

const COLS = 6
const ROWS = SLOTS_PER_BED / COLS

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function tankRect(s: GameState): Rect {
  const w = 420 + s.equip.tankLevel * 90
  return { x: (W - w) / 2, y: 330, w, h: 170 }
}

export function bedRects(s: GameState): Rect[] {
  const n = s.equip.beds
  const gap = 16
  const maxW = 330
  const w = Math.min(maxW, (W - 40 - gap * (n - 1)) / n)
  const total = n * w + (n - 1) * gap
  const x0 = (W - total) / 2
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), y: 222, w, h: 44 }))
}

/** Position eines Pflanzplatzes (Fußpunkt der Pflanze) */
export function slotPos(s: GameState, slot: number) {
  const bed = Math.floor(slot / SLOTS_PER_BED)
  const i = slot % SLOTS_PER_BED
  const r = bedRects(s)[bed]
  const row = Math.floor(i / COLS)
  const col = i % COLS
  const depth = row / (ROWS - 1) // 0 = hinten, 1 = vorne
  const inset = 14 - depth * 8
  const colW = (r.w - 2 * inset) / COLS
  // Reihen versetzt, damit die hinteren Pflanzen zwischen den vorderen hervorschauen
  const x = r.x + inset + (col + 0.5) * colW + (row - 1) * colW * 0.3
  const y = r.y + 4 + depth * 12
  return { x, y, scale: 0.78 + depth * 0.22, bedW: r.w }
}

/** Welcher Pflanzplatz liegt unter dem Punkt? */
export function hitSlot(s: GameState, x: number, y: number) {
  const rects = bedRects(s)
  for (let b = 0; b < rects.length; b++) {
    const r = rects[b]
    if (x < r.x || x > r.x + r.w || y < r.y - 120 || y > r.y + r.h) continue
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < SLOTS_PER_BED; i++) {
      const slot = b * SLOTS_PER_BED + i
      const p = slotPos(s, slot)
      const d = Math.abs(p.x - x) + Math.abs(p.y - 20 - y) * 0.3
      if (d < bestD) {
        bestD = d
        best = slot
      }
    }
    return best
  }
  return -1
}

// --- Fische als bewegte Figuren (nur Darstellung, nicht Teil des Spielstands) ---

interface Sprite {
  group: number
  x: number
  y: number
  vx: number
  vy: number
  phase: number
  target: { x: number; y: number }
  retarget: number
}

const sprites: Sprite[] = []
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function syncSprites(s: GameState, tank: Rect) {
  const total = s.fish.reduce((a, g) => a + g.count, 0)
  const scale = total > 60 ? 60 / total : 1
  const want = new Map<number, number>()
  for (const g of s.fish) want.set(g.id, Math.max(1, Math.round(g.count * scale)))
  const have = new Map<number, number>()
  for (let i = sprites.length - 1; i >= 0; i--) {
    const sp = sprites[i]
    const n = have.get(sp.group) ?? 0
    if (n >= (want.get(sp.group) ?? 0)) {
      sprites.splice(i, 1)
      continue
    }
    have.set(sp.group, n + 1)
  }
  for (const g of s.fish) {
    const n = have.get(g.id) ?? 0
    for (let i = n; i < (want.get(g.id) ?? 0); i++) {
      const x = rand(tank.x + 40, tank.x + tank.w - 40)
      const y = rand(tank.y + 50, tank.y + tank.h - 30)
      sprites.push({ group: g.id, x, y, vx: rand(-20, 20), vy: 0, phase: rand(0, 6), target: { x, y }, retarget: 0 })
    }
  }
}

function fishLength(g: FishGroup) {
  return 14 + 9 * Math.cbrt(g.weight / 10)
}

// --- Zufallszahlen mit festem Startwert, damit Pflanzen gleich aussehen ---
function seeded(seed: number) {
  let a = seed * 2654435761
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pebbles: { x: number; y: number; r: number; c: string }[] = []
for (let i = 0; i < 260; i++) {
  const r = seeded(i + 7)
  pebbles.push({ x: r(), y: r(), r: 1.6 + r() * 2.2, c: `hsl(${18 + r() * 14},${45 + r() * 15}%,${38 + r() * 14}%)` })
}

function leafColor(p: Plant, light = 0) {
  if (p.dead) return `hsl(32,35%,${30 + light}%)`
  const hue = 112 - p.chlorosis * 55 - (1 - p.health / 100) * 40
  const sat = 52 - p.nDeficit * 25
  const lig = 32 + p.chlorosis * 18 + p.nDeficit * 14 + light
  return `hsl(${hue},${sat}%,${lig}%)`
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, angle: number, color: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len)
  ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0)
  ctx.fill()
  ctx.restore()
}

function drawPlant(ctx: CanvasRenderingContext2D, p: Plant, x: number, y: number, scale: number, wilt: number, selected: boolean, time: number) {
  const sp = PLANTS[p.species]
  const g = clamp(p.mass / plantMaxMass(sp), 0.02, 1)
  const rnd = seeded(p.id)
  const sway = Math.sin(time * 1.3 + p.id) * 0.03
  const droop = wilt * 0.9 + (p.dead ? 0.9 : 0)
  const col = leafColor(p)
  const col2 = leafColor(p, 8)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  if (selected) {
    ctx.fillStyle = 'rgba(255,230,120,0.55)'
    ctx.beginPath()
    ctx.ellipse(0, 2, 22, 7, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  switch (p.species) {
    case 'salat': {
      const r = 6 + 26 * Math.sqrt(g)
      const n = 7 + Math.round(g * 8)
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * (2.4 + droop) + sway
        leaf(ctx, 0, 0, r * (0.75 + rnd() * 0.35), r * 0.55, a + Math.PI / 2, i % 2 ? col : col2)
      }
      for (let i = 0; i < 4; i++) leaf(ctx, 0, 0, r * 0.6, r * 0.4, (i - 1.5) * 0.4 + sway, col2)
      break
    }
    case 'mangold': {
      const h = 10 + 62 * Math.sqrt(g)
      const n = 4 + Math.round(g * 6)
      for (let i = 0; i < n; i++) {
        const a = ((i / Math.max(1, n - 1)) - 0.5) * (1.3 + droop * 1.5) + sway
        const len = h * (0.7 + rnd() * 0.3)
        ctx.save()
        ctx.rotate(a)
        ctx.strokeStyle = p.dead ? '#6b4a2f' : ['#c0392b', '#e1b12c', '#c0392b', '#f5f0e1'][i % 4]
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -len * 0.45)
        ctx.stroke()
        leaf(ctx, 0, -len * 0.35, len * 0.65, len * 0.22, 0, i % 2 ? col : col2)
        ctx.restore()
      }
      break
    }
    case 'basilikum':
    case 'minze': {
      const h = 8 + (p.species === 'minze' ? 40 : 50) * Math.sqrt(g)
      const stems = p.species === 'minze' ? 3 + Math.round(g * 3) : 1 + Math.round(g * 2)
      for (let st = 0; st < stems; st++) {
        const a = (stems === 1 ? 0 : ((st / (stems - 1)) - 0.5) * 0.9) + sway + (st % 2 ? 1 : -1) * droop * 0.4
        ctx.save()
        ctx.rotate(a)
        ctx.strokeStyle = p.dead ? '#6b4a2f' : '#4f7a3a'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -h)
        ctx.stroke()
        const pairs = 2 + Math.round(g * 4)
        for (let k = 0; k < pairs; k++) {
          const yy = -h * (0.25 + (0.75 * k) / pairs)
          const size = (p.species === 'minze' ? 7 : 9) * (1 - k / (pairs * 1.6)) * (0.6 + g * 0.6)
          const dd = droop * 1.2
          leaf(ctx, 0, yy, size, size * 0.6, 1.1 + dd, k % 2 ? col : col2)
          leaf(ctx, 0, yy, size, size * 0.6, -1.1 - dd, k % 2 ? col2 : col)
        }
        leaf(ctx, 0, -h, 7 * (0.6 + g * 0.5), 4, 0, col2)
        ctx.restore()
      }
      break
    }
    case 'tomate': {
      const h = 16 + 150 * Math.sqrt(g)
      // Stab
      ctx.strokeStyle = '#a07a4a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(5, 0)
      ctx.lineTo(5, -Math.max(40, h + 6))
      ctx.stroke()
      ctx.strokeStyle = p.dead ? '#6b4a2f' : '#4f7a3a'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(-4 + sway * 40, -h * 0.5, 2, -h)
      ctx.stroke()
      const n = 3 + Math.round(g * 9)
      for (let k = 0; k < n; k++) {
        const yy = -h * (0.15 + (0.85 * k) / n)
        const side = k % 2 ? 1 : -1
        const size = 14 * (0.5 + g * 0.6)
        leaf(ctx, 0, yy, size, size * 0.5, side * (1.2 + droop) + sway, k % 3 ? col : col2)
      }
      const fruits = Math.min(14, Math.floor(p.fruit / 60))
      for (let f = 0; f < fruits; f++) {
        const yy = -h * (0.2 + 0.6 * rnd())
        const xx = (rnd() - 0.5) * 22
        const ripe = f < fruits * 0.6
        ctx.fillStyle = ripe ? '#d6322a' : '#8fbf4a'
        ctx.beginPath()
        ctx.arc(xx, yy, 3.6, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
  }
  ctx.restore()
}

function drawFish(ctx: CanvasRenderingContext2D, g: FishGroup, sp: Sprite, time: number) {
  const f = FISH[g.species]
  const len = fishLength(g)
  const dir = sp.vx >= 0 ? 1 : -1
  const sick = g.health < 40
  ctx.save()
  ctx.translate(sp.x, sp.y)
  ctx.scale(dir, 1)
  if (sick) ctx.rotate(0.35)
  const tail = Math.sin(time * (sick ? 4 : 9) + sp.phase) * 0.35
  // Schwanz
  ctx.fillStyle = f.fin
  ctx.beginPath()
  ctx.moveTo(-len * 0.38, 0)
  ctx.lineTo(-len * 0.62, -len * 0.2 + tail * len * 0.15)
  ctx.lineTo(-len * 0.58, tail * len * 0.1)
  ctx.lineTo(-len * 0.62, len * 0.2 + tail * len * 0.15)
  ctx.closePath()
  ctx.fill()
  // Körper
  const bodyH = g.species === 'wels' ? 0.17 : g.species === 'karpfen' ? 0.26 : 0.22
  const grad = ctx.createLinearGradient(0, -len * bodyH, 0, len * bodyH)
  grad.addColorStop(0, f.body)
  grad.addColorStop(1, f.belly)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(0, 0, len * 0.45, len * bodyH, 0, 0, Math.PI * 2)
  ctx.fill()
  // Rückenflosse
  ctx.fillStyle = f.fin
  ctx.beginPath()
  ctx.moveTo(-len * 0.12, -len * bodyH * 0.9)
  ctx.lineTo(len * 0.05, -len * bodyH * 1.6)
  ctx.lineTo(len * 0.14, -len * bodyH * 0.9)
  ctx.fill()
  if (g.species === 'forelle') {
    ctx.fillStyle = 'rgba(214,90,120,0.55)'
    ctx.fillRect(-len * 0.35, -len * 0.03, len * 0.7, len * 0.05)
    ctx.fillStyle = 'rgba(40,40,40,0.5)'
    for (let i = 0; i < 6; i++) ctx.fillRect(-len * 0.3 + i * len * 0.11, -len * 0.12 + (i % 2) * 4, 1.5, 1.5)
  }
  if (g.species === 'wels') {
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(len * 0.42, len * 0.03)
    ctx.lineTo(len * 0.62, len * 0.12)
    ctx.moveTo(len * 0.42, len * 0.05)
    ctx.lineTo(len * 0.58, len * 0.2)
    ctx.stroke()
  }
  // Auge
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(len * 0.3, -len * 0.05, Math.max(1.5, len * 0.045), 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#111'
  ctx.beginPath()
  ctx.arc(len * 0.31, -len * 0.05, Math.max(0.8, len * 0.025), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

let lastTime = 0

/** Zeichnet ein Bild. `time` in Sekunden (Echtzeit) für Animationen. */
export function drawScene(ctx: CanvasRenderingContext2D, s: GameState, time: number, selectedSlot: number, running: boolean) {
  const dt = Math.min(0.1, Math.max(0, time - lastTime))
  lastTime = time
  const light = currentLight(s)
  const w = s.water
  const tank = tankRect(s)
  const beds = bedRects(s)
  const pump = s.equip.pumpOn

  // Himmel
  const night = 1 - clamp(light * 2.2)
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, mix('#a9d8f0', '#0e1a33', night))
  sky.addColorStop(1, mix('#e9f3e2', '#1c2a3a', night))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  // Gewächshaus-Rahmen
  ctx.strokeStyle = mix('rgba(255,255,255,0.75)', 'rgba(150,170,200,0.35)', night)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(10, 150)
  ctx.lineTo(W / 2, 18)
  ctx.lineTo(W - 10, 150)
  ctx.moveTo(10, 150)
  ctx.lineTo(10, H)
  ctx.moveTo(W - 10, 150)
  ctx.lineTo(W - 10, H)
  for (let i = 1; i < 8; i++) {
    const x = 10 + (i * (W - 20)) / 8
    const yTop = x < W / 2 ? 150 - ((x - 10) / (W / 2 - 10)) * 132 : 150 - ((W - 10 - x) / (W / 2 - 10)) * 132
    ctx.moveTo(x, yTop)
    ctx.lineTo(x, H)
  }
  ctx.stroke()

  // Boden
  ctx.fillStyle = mix('#b9a98c', '#3a3530', night)
  ctx.fillRect(0, H - 22, W, 22)

  // Rohre
  const pipeCol = '#d9d9d9'
  ctx.lineCap = 'round'
  ctx.strokeStyle = pipeCol
  ctx.lineWidth = 7
  ctx.beginPath()
  const px = tank.x + 30
  ctx.moveTo(px, tank.y + tank.h - 30)
  ctx.lineTo(px, beds[0].y - 18)
  ctx.lineTo(beds[beds.length - 1].x + beds[beds.length - 1].w - 20, beds[0].y - 18)
  ctx.stroke()
  for (const b of beds) {
    ctx.beginPath()
    ctx.moveTo(b.x + b.w * 0.5, beds[0].y - 18)
    ctx.lineTo(b.x + b.w * 0.5, b.y - 2)
    ctx.stroke()
  }
  // Rücklauf
  const rx = tank.x + tank.w - 40
  ctx.beginPath()
  ctx.moveTo(beds[beds.length - 1].x + beds[beds.length - 1].w - 30, beds[0].y + beds[0].h)
  ctx.lineTo(rx, beds[0].y + beds[0].h)
  ctx.lineTo(rx, tank.y - 6)
  ctx.stroke()
  ctx.lineCap = 'butt'
  // Pumpe
  ctx.fillStyle = '#2f3b45'
  ctx.fillRect(px - 10, tank.y + tank.h - 34, 20, 20)
  ctx.fillStyle = pump ? '#6ad06a' : '#c44'
  ctx.fillRect(px - 3, tank.y + tank.h - 30, 6, 4)

  // Pflanzbeete (Gestell)
  for (const b of beds) {
    ctx.fillStyle = '#5b4a3a'
    ctx.fillRect(b.x + 8, b.y + b.h, 6, tank.y - b.y - b.h - 4)
    ctx.fillRect(b.x + b.w - 14, b.y + b.h, 6, tank.y - b.y - b.h - 4)
  }

  // Pflanzen hinten zuerst, Beet davor
  const time2 = time
  const wilt = clamp((s.dryHours - 3) / 24)
  for (let bi = 0; bi < beds.length; bi++) {
    const b = beds[bi]
    // Beet-Rückwand
    ctx.fillStyle = '#3d4f5c'
    ctx.fillRect(b.x, b.y - 4, b.w, 8)
    for (let i = 0; i < SLOTS_PER_BED; i++) {
      const slot = bi * SLOTS_PER_BED + i
      const p = s.slots[slot]
      const pos = slotPos(s, slot)
      if (p) drawPlant(ctx, p, pos.x, pos.y, pos.scale, wilt, slot === selectedSlot, time2)
      else if (slot === selectedSlot) {
        ctx.fillStyle = 'rgba(255,230,120,0.7)'
        ctx.beginPath()
        ctx.ellipse(pos.x, pos.y + 2, 10, 4, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // Beet-Front mit Blähton
    ctx.fillStyle = '#44606f'
    ctx.fillRect(b.x, b.y + 12, b.w, b.h - 12)
    ctx.save()
    ctx.beginPath()
    ctx.rect(b.x + 3, b.y + 14, b.w - 6, b.h - 18)
    ctx.clip()
    ctx.fillStyle = '#7a5236'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    for (const pb of pebbles) {
      ctx.fillStyle = pb.c
      ctx.beginPath()
      ctx.arc(b.x + pb.x * b.w, b.y + 14 + pb.y * (b.h - 18), pb.r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Wasserstand im Beet (Glockensiphon füllt und leert)
    if (pump) {
      const fill = (Math.sin(time * 0.6 + bi) + 1) / 2
      ctx.fillStyle = 'rgba(80,150,200,0.28)'
      const hh = (b.h - 18) * (0.25 + fill * 0.5)
      ctx.fillRect(b.x, b.y + b.h - 4 - hh, b.w, hh)
    }
    ctx.restore()
  }

  // Wasserstrahl aus dem Rücklauf
  if (pump) {
    ctx.strokeStyle = 'rgba(120,190,230,0.85)'
    ctx.lineWidth = 4
    ctx.setLineDash([6, 5])
    ctx.lineDashOffset = -time * 40
    ctx.beginPath()
    ctx.moveTo(rx, tank.y - 6)
    ctx.lineTo(rx, tank.y + 24)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // --- Fischtank ---
  const surface = tank.y + 14
  ctx.fillStyle = 'rgba(220,235,240,0.35)'
  ctx.fillRect(tank.x, tank.y, tank.w, tank.h)
  const turb = clamp(w.solids / 600)
  const algae = clamp((w.no3 - 20) / 200) * 0.5
  const waterTop = mix(mix('#5fb0cf', '#6f9a4a', algae), '#7b6a45', turb * 0.7)
  const waterBot = mix(mix('#2f6f8f', '#3f6a33', algae), '#5a4a30', turb * 0.7)
  const wg = ctx.createLinearGradient(0, surface, 0, tank.y + tank.h)
  wg.addColorStop(0, waterTop)
  wg.addColorStop(1, waterBot)
  ctx.fillStyle = wg
  ctx.fillRect(tank.x + 3, surface, tank.w - 6, tank.h - 17)
  // Kies
  ctx.fillStyle = '#8b7d66'
  ctx.fillRect(tank.x + 3, tank.y + tank.h - 12, tank.w - 6, 9)
  // Schlamm
  if (w.solids > 20) {
    ctx.fillStyle = 'rgba(70,50,30,0.8)'
    ctx.fillRect(tank.x + 3, tank.y + tank.h - 12 - clamp(w.solids / 150, 0, 8), tank.w - 6, clamp(w.solids / 150, 0, 8))
  }
  // Heizstab
  if (s.equip.heater) {
    const heating = s.equip.heaterOn && w.temp < s.equip.heaterSet - 0.05
    ctx.fillStyle = heating ? '#ff8a3d' : '#666'
    ctx.fillRect(tank.x + tank.w - 18, surface + 6, 6, 90)
  }
  // Luftsprudler
  if (s.equip.airPump > 0) {
    const n = s.equip.airPump * 14
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    for (let i = 0; i < n; i++) {
      const stone = (i % s.equip.airPump) / s.equip.airPump
      const bx = tank.x + 80 + stone * (tank.w - 160) + Math.sin(time * 3 + i) * 3
      const prog = ((time * 0.6 + i * 0.137) % 1 + 1) % 1
      const by = tank.y + tank.h - 14 - prog * (tank.h - 30)
      ctx.beginPath()
      ctx.arc(bx, by, 1.5 + prog * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#555'
    for (let k = 0; k < s.equip.airPump; k++) ctx.fillRect(tank.x + 74 + (k / s.equip.airPump) * (tank.w - 160), tank.y + tank.h - 16, 12, 5)
  }

  // Fische
  syncSprites(s, tank)
  const gasp = w.o2 < 2.5
  const feeding = w.floatingFeed > 0.2
  const byId = new Map(s.fish.map((g) => [g.id, g]))
  for (const sp of sprites) {
    const g = byId.get(sp.group)
    if (!g) continue
    const len = fishLength(g)
    const minX = tank.x + 8 + len * 0.6
    const maxX = tank.x + tank.w - 8 - len * 0.6
    const minY = surface + 8 + len * 0.2
    const maxY = tank.y + tank.h - 16 - len * 0.2
    sp.retarget -= dt
    if (sp.retarget <= 0) {
      sp.retarget = rand(1.5, 4)
      const bottom = g.species === 'wels' || g.species === 'karpfen'
      sp.target = {
        x: rand(minX, maxX),
        y: gasp || feeding ? minY + rand(0, 10) : bottom ? rand((minY + maxY) / 2, maxY) : rand(minY, maxY),
      }
    }
    const speed = (g.health < 40 ? 12 : 35) * (running ? 1 : 0.4)
    const ax = clamp((sp.target.x - sp.x) * 0.8, -speed, speed)
    const ay = clamp((sp.target.y - sp.y) * 0.8, -speed, speed)
    sp.vx += (ax - sp.vx) * dt * 1.5
    sp.vy += (ay - sp.vy) * dt * 1.5
    sp.x = clamp(sp.x + sp.vx * dt, minX, maxX)
    sp.y = clamp(sp.y + sp.vy * dt, minY, maxY)
    drawFish(ctx, g, sp, time)
  }

  // Tote Fische an der Oberfläche
  const deadShown = Math.min(12, w.deadCount)
  for (let i = 0; i < deadShown; i++) {
    const x = tank.x + 40 + ((i * 97) % (tank.w - 80))
    ctx.save()
    ctx.translate(x, surface + 4)
    ctx.rotate(Math.PI)
    ctx.fillStyle = '#e8e4da'
    ctx.beginPath()
    ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#999'
    ctx.fillRect(12, -4, 6, 8)
    ctx.restore()
  }

  // Futter an der Oberfläche
  const pellets = Math.min(60, Math.round(w.floatingFeed * 2))
  ctx.fillStyle = '#7a4b1e'
  for (let i = 0; i < pellets; i++) {
    const x = tank.x + 120 + ((i * 53) % 200) + Math.sin(time + i) * 3
    ctx.fillRect(x, surface + 1 + (i % 3), 2.5, 2.5)
  }

  // Wasseroberfläche
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = tank.x + 3; x <= tank.x + tank.w - 3; x += 6) {
    const yy = surface + Math.sin(x * 0.05 + time * 2) * 1.2
    if (x === tank.x + 3) ctx.moveTo(x, yy)
    else ctx.lineTo(x, yy)
  }
  ctx.stroke()

  // Glasrahmen
  ctx.strokeStyle = '#2b3a44'
  ctx.lineWidth = 5
  ctx.strokeRect(tank.x, tank.y, tank.w, tank.h)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(tank.x + 12, tank.y + 6, 18, tank.h - 12)

  // Nacht
  if (night > 0) {
    ctx.fillStyle = `rgba(5,10,30,${night * 0.45})`
    ctx.fillRect(0, 0, W, H)
  }
}

function mix(a: string, b: string, t: number) {
  if (t <= 0) return a
  if (t >= 1) return b
  const pa = parse(a)
  const pb = parse(b)
  const r = pa.map((v, i) => v + (pb[i] - v) * t)
  return `rgba(${r[0] | 0},${r[1] | 0},${r[2] | 0},${r[3].toFixed(3)})`
}

const parseCache = new Map<string, number[]>()
function parse(c: string): number[] {
  let v = parseCache.get(c)
  if (v) return v
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16)
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  } else {
    v = c.replace(/rgba?\(|\)/g, '').split(',').map(Number)
    if (v.length === 3) v.push(1)
  }
  parseCache.set(c, v)
  return v
}
