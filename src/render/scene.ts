// Zeichnet die Anlage in Perspektive: Folientunnel, Schwimmbeete mit Pflanzen,
// runde Fischbecken mit Fischen, Biofilter und Edelstahlrohre.
import { clamp } from '../sim/chemistry.ts'
import { FISH, PLANTS, SLOTS_PER_BED } from '../sim/data.ts'
import { currentLight, plantMaxMass } from '../sim/simulate.ts'
import type { FishGroup, GameState, Plant } from '../sim/state.ts'

export const W = 800
export const H = 640

// --- Kamera ---
const F = 360
const HORIZON = 150
const CAM_H = 4

interface P2 {
  x: number
  y: number
}

/** Weltkoordinaten (m): x nach rechts, y nach oben, z in die Tiefe */
function proj(x: number, y: number, z: number): P2 {
  return { x: W / 2 + (x * F) / z, y: HORIZON + ((CAM_H - y) * F) / z }
}
const px = (m: number, z: number) => (m * F) / z

// --- Aufbau der Anlage ---
const BED_Z0 = 8.6
const BED_Z1 = 34
const BED_H = 0.85
const BED_W = 2.4
const BED_X = [-1.5, 1.5, -4.7, 4.7]
const SEC_ACROSS = 2
const SEC_ALONG = SLOTS_PER_BED / SEC_ACROSS
const TUNNEL_HALF = 7.6
const TUNNEL_WALL = 2.3
const TUNNEL_APEX = 6.2
const TUNNEL_END = 40
const TANK_H = 0.9

interface Tank {
  x: number
  z: number
  r: number
}

function tanks(s: GameState): Tank[] {
  const n = [1, 2, 4][s.equip.tankLevel] ?? 1
  if (n === 1) return [{ x: -1.9, z: 4.6, r: 1.5 }]
  const front = [
    { x: -2.05, z: 4.6, r: 1.5 },
    { x: 2.05, z: 4.6, r: 1.5 },
  ]
  if (n === 2) return front
  return [{ x: -2.05, z: 7.6, r: 1.3 }, { x: 2.05, z: 7.6, r: 1.3 }, ...front]
}

/** Ecken eines Pflanz-Abschnitts auf der Beetoberfläche */
function sectionQuad(bed: number, i: number): P2[] {
  const cx = BED_X[bed]
  const col = i % SEC_ACROSS
  const row = Math.floor(i / SEC_ACROSS) // 0 = vorne
  const x0 = cx - BED_W / 2 + 0.08 + (col * (BED_W - 0.16)) / SEC_ACROSS
  const x1 = x0 + (BED_W - 0.16) / SEC_ACROSS
  const len = (BED_Z1 - BED_Z0) / SEC_ALONG
  const z0 = BED_Z0 + row * len
  const z1 = z0 + len
  return [proj(x0, BED_H, z0), proj(x1, BED_H, z0), proj(x1, BED_H, z1), proj(x0, BED_H, z1)]
}

function inPoly(pt: P2, poly: P2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Welcher Pflanzplatz liegt unter dem Punkt? (-1 = keiner) */
export function hitSlot(s: GameState, x: number, y: number) {
  if (hitTank(s, x, y)) return -1
  for (let b = 0; b < s.equip.beds; b++)
    for (let i = 0; i < SLOTS_PER_BED; i++) {
      const q = sectionQuad(b, i)
      // Pflanzen ragen nach oben: Fläche etwas nach oben erweitern
      const lift = (q[0].y - q[3].y) * 0.4 + 6
      const poly = [q[0], q[1], { x: q[2].x, y: q[2].y - lift }, { x: q[3].x, y: q[3].y - lift }]
      if (inPoly({ x, y }, poly)) return b * SLOTS_PER_BED + i
    }
  return -1
}

export function hitTank(s: GameState, x: number, y: number) {
  return tanks(s).some((t) => {
    const c = proj(t.x, TANK_H, t.z)
    const rx = px(t.r, t.z)
    const bottom = proj(t.x, 0, t.z - t.r).y
    return Math.abs(x - c.x) < rx && y > c.y - rx * 0.45 && y < bottom
  })
}

// --- Zufall mit Startwert ---
function seeded(seed: number) {
  let a = (seed * 2654435761) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Farben ---
function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%,${a})`
}

function plantHue(p: Plant) {
  if (p.dead) return { h: 32, s: 35, l: 32 }
  return {
    h: 105 - p.chlorosis * 50 - (1 - p.health / 100) * 45,
    s: 58 - p.nDeficit * 28,
    l: 36 + p.chlorosis * 16 + p.nDeficit * 12,
  }
}

// ===================== Statische Ebene: Tunnel, Beete, Pflanzen =====================

function drawTunnel(ctx: CanvasRenderingContext2D) {
  // Hintergrund: helle Folie
  const bg = ctx.createLinearGradient(0, 0, 0, HORIZON + 40)
  bg.addColorStop(0, '#f4f8fa')
  bg.addColorStop(1, '#dfe9ee')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Seitenwände unten etwas grünlich (Pflanzen draußen schimmern durch)
  for (const side of [-1, 1]) {
    const a = proj(side * TUNNEL_HALF, 0, 2.2)
    const b = proj(side * TUNNEL_HALF, 0, TUNNEL_END)
    const c = proj(side * TUNNEL_HALF, TUNNEL_WALL, TUNNEL_END)
    const d = proj(side * TUNNEL_HALF, TUNNEL_WALL, 2.2)
    const g = ctx.createLinearGradient(a.x, 0, b.x, 0)
    g.addColorStop(0, 'rgba(176,196,170,0.9)')
    g.addColorStop(1, 'rgba(214,226,214,0.9)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.fill()
  }

  // Giebelwand hinten
  const gable: P2[] = []
  for (let k = 0; k <= 24; k++) {
    const th = (Math.PI * k) / 24
    gable.push(proj(-Math.cos(th) * TUNNEL_HALF, TUNNEL_WALL + Math.sin(th) * (TUNNEL_APEX - TUNNEL_WALL), TUNNEL_END))
  }
  ctx.fillStyle = '#fbfdfe'
  ctx.beginPath()
  ctx.moveTo(proj(-TUNNEL_HALF, 0, TUNNEL_END).x, proj(-TUNNEL_HALF, 0, TUNNEL_END).y)
  gable.forEach((p) => ctx.lineTo(p.x, p.y))
  ctx.lineTo(proj(TUNNEL_HALF, 0, TUNNEL_END).x, proj(TUNNEL_HALF, 0, TUNNEL_END).y)
  ctx.fill()
  // Tor
  const d0 = proj(-0.9, 0, TUNNEL_END)
  const d1 = proj(0.9, 2.2, TUNNEL_END)
  ctx.fillStyle = '#e4ecef'
  ctx.fillRect(d0.x, d1.y, d1.x - d0.x, d0.y - d1.y)
  ctx.strokeStyle = '#b8c4ca'
  ctx.lineWidth = 1
  ctx.strokeRect(d0.x, d1.y, d1.x - d0.x, d0.y - d1.y)

  // Boden
  const f0 = proj(-TUNNEL_HALF, 0, 2.2)
  const f1 = proj(TUNNEL_HALF, 0, 2.2)
  const f2 = proj(TUNNEL_HALF, 0, TUNNEL_END)
  const f3 = proj(-TUNNEL_HALF, 0, TUNNEL_END)
  const fg = ctx.createLinearGradient(0, f3.y, 0, H)
  fg.addColorStop(0, '#d9d6cf')
  fg.addColorStop(1, '#bdb8ae')
  ctx.fillStyle = fg
  ctx.beginPath()
  ctx.moveTo(f0.x, f0.y)
  ctx.lineTo(f1.x, f1.y)
  ctx.lineTo(f2.x, f2.y)
  ctx.lineTo(f3.x, f3.y)
  ctx.fill()
  // Fugen im Betonboden
  ctx.strokeStyle = 'rgba(120,112,100,0.18)'
  ctx.lineWidth = 1
  for (let z = 4; z < TUNNEL_END; z += 4) {
    const a = proj(-TUNNEL_HALF, 0, z)
    const b = proj(TUNNEL_HALF, 0, z)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // Bögen und Längsstreben
  const archPoint = (th: number, z: number) => {
    // th: 0 = links unten, 1 = rechts unten
    if (th < 0.12) return proj(-TUNNEL_HALF, (th / 0.12) * TUNNEL_WALL, z)
    if (th > 0.88) return proj(TUNNEL_HALF, ((1 - th) / 0.12) * TUNNEL_WALL, z)
    const a = Math.PI * ((th - 0.12) / 0.76)
    return proj(-Math.cos(a) * TUNNEL_HALF, TUNNEL_WALL + Math.sin(a) * (TUNNEL_APEX - TUNNEL_WALL), z)
  }
  for (let z = TUNNEL_END; z >= 2.4; z -= 2.6) {
    ctx.strokeStyle = `rgba(120,132,140,${clamp(0.35 + 4 / z, 0, 0.9)})`
    ctx.lineWidth = clamp(px(0.06, z), 0.6, 5)
    ctx.beginPath()
    for (let k = 0; k <= 40; k++) {
      const p = archPoint(k / 40, z)
      if (k === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  for (const th of [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.05, 0.95]) {
    ctx.strokeStyle = 'rgba(130,140,148,0.55)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let z = 2.4; z <= TUNNEL_END; z += 0.8) {
      const p = archPoint(th, z)
      if (z === 2.4) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }
  // Lampen an der Mittelstrebe
  for (let z = 6; z < TUNNEL_END; z += 6) {
    const p = proj(0, TUNNEL_APEX - 0.5, z)
    ctx.fillStyle = '#6b767c'
    ctx.fillRect(p.x - px(0.25, z), p.y, px(0.5, z), Math.max(1, px(0.08, z)))
  }
}

function quadPath(ctx: CanvasRenderingContext2D, q: P2[]) {
  ctx.beginPath()
  ctx.moveTo(q[0].x, q[0].y)
  for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y)
  ctx.closePath()
}

function drawBedFrame(ctx: CanvasRenderingContext2D, bed: number) {
  const cx = BED_X[bed]
  const x0 = cx - BED_W / 2
  const x1 = cx + BED_W / 2
  // Beine
  ctx.fillStyle = '#8f989d'
  for (let z = BED_Z1; z >= BED_Z0; z -= 3) {
    for (const x of [x0 + 0.1, x1 - 0.1]) {
      const a = proj(x, 0, z)
      const b = proj(x, BED_H - 0.15, z)
      ctx.fillRect(a.x - px(0.03, z), b.y, Math.max(1, px(0.06, z)), a.y - b.y)
    }
  }
  // Wanne: Seitenwand zur Mitte hin sichtbar
  const sideX = cx < 0 ? x1 : x0
  const s0 = proj(sideX, BED_H, BED_Z0)
  const s1 = proj(sideX, BED_H, BED_Z1)
  const s2 = proj(sideX, BED_H - 0.22, BED_Z1)
  const s3 = proj(sideX, BED_H - 0.22, BED_Z0)
  ctx.fillStyle = '#c9d0d3'
  quadPath(ctx, [s0, s1, s2, s3])
  ctx.fill()
  // Front
  const a = proj(x0, BED_H, BED_Z0)
  const b = proj(x1, BED_H, BED_Z0)
  const c = proj(x1, BED_H - 0.22, BED_Z0)
  const d = proj(x0, BED_H - 0.22, BED_Z0)
  ctx.fillStyle = '#e6eaec'
  quadPath(ctx, [a, b, c, d])
  ctx.fill()
  ctx.strokeStyle = '#a6aeb2'
  ctx.lineWidth = 1
  ctx.stroke()
  // Wasser und Styroporplatten
  const top = [proj(x0, BED_H, BED_Z0), proj(x1, BED_H, BED_Z0), proj(x1, BED_H, BED_Z1), proj(x0, BED_H, BED_Z1)]
  ctx.fillStyle = '#5b7e86'
  quadPath(ctx, top)
  ctx.fill()
  for (let i = 0; i < SLOTS_PER_BED; i++) {
    const q = sectionQuad(bed, i)
    ctx.fillStyle = '#f3f4f1'
    quadPath(ctx, q)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,130,130,0.5)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  // Wasserrohr an der Front
  const pa = proj(x0 - 0.05, BED_H - 0.3, BED_Z0 - 0.15)
  const pb = proj(x1 + 0.05, BED_H - 0.3, BED_Z0 - 0.15)
  steelLine(ctx, pa, pb, px(0.12, BED_Z0))
}

/** Pflanzenpositionen in einem Abschnitt (Welt-Koordinaten), von hinten nach vorne */
function sectionHeads(bed: number, i: number, p: Plant) {
  const sp = PLANTS[p.species]
  const tall = !!sp.fruiting
  const across = tall ? 2 : 3
  const along = tall ? 3 : 6
  const cx = BED_X[bed]
  const col = i % SEC_ACROSS
  const row = Math.floor(i / SEC_ACROSS)
  const x0 = cx - BED_W / 2 + 0.08 + (col * (BED_W - 0.16)) / SEC_ACROSS
  const w = (BED_W - 0.16) / SEC_ACROSS
  const len = (BED_Z1 - BED_Z0) / SEC_ALONG
  const z0 = BED_Z0 + row * len
  const rnd = seeded(p.id * 31 + i)
  const out: { x: number; z: number; j: number }[] = []
  for (let b = along - 1; b >= 0; b--)
    for (let a = 0; a < across; a++)
      out.push({
        x: x0 + ((a + 0.5) * w) / across + (rnd() - 0.5) * 0.06,
        z: z0 + ((b + 0.5) * len) / along + (rnd() - 0.5) * 0.08,
        j: rnd(),
      })
  return out
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, Math.max(0.4, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawHead(ctx: CanvasRenderingContext2D, p: Plant, wx: number, wz: number, jitter: number, wilt: number) {
  const sp = PLANTS[p.species]
  const g = clamp(p.mass / plantMaxMass(sp), 0.03, 1)
  const c = plantHue(p)
  const base = proj(wx, BED_H, wz)
  const droop = wilt + (p.dead ? 0.7 : 0)
  const dark = hsl(c.h, c.s, c.l - 10)
  const mid = hsl(c.h + jitter * 8, c.s, c.l)
  const light = hsl(c.h + 6, c.s - 4, c.l + 12)
  switch (p.species) {
    case 'salat':
    case 'mangold':
    case 'minze':
    case 'basilikum': {
      const sizeM = (p.species === 'salat' ? 0.3 : p.species === 'mangold' ? 0.34 : 0.22) * (0.25 + 0.75 * Math.sqrt(g))
      const hM = (p.species === 'mangold' ? 0.4 : p.species === 'basilikum' ? 0.3 : p.species === 'minze' ? 0.22 : 0.16) * (0.2 + 0.8 * Math.sqrt(g)) * (1 - droop * 0.6)
      const r = px(sizeM / 2, wz)
      const top = proj(wx, BED_H + hM, wz).y
      if (r < 1.6) {
        blob(ctx, base.x, (base.y + top) / 2, r, Math.max(0.5, (base.y - top) / 2 + r * 0.3), mid)
        return
      }
      if (p.species === 'mangold' && !p.dead) {
        ctx.strokeStyle = ['#c8372d', '#e0b02a', '#f1ece0'][Math.floor(jitter * 3)]
        ctx.lineWidth = Math.max(0.6, r * 0.12)
        for (let k = -2; k <= 2; k++) {
          ctx.beginPath()
          ctx.moveTo(base.x, base.y)
          ctx.lineTo(base.x + k * r * 0.3, top + r * 0.4)
          ctx.stroke()
        }
      }
      const pts = p.species === 'salat' ? 7 : 6
      // Schatten auf der Platte
      blob(ctx, base.x + r * 0.15, base.y + r * 0.08, r * 1.05, r * 0.35, 'rgba(60,70,60,0.22)')
      for (let k = 0; k < pts; k++) {
        const a = (k / pts) * Math.PI * 2 + jitter * 3
        const ox = Math.cos(a) * r * 0.6
        const oy = Math.sin(a) * r * 0.25
        const y = (p.species === 'salat' ? base.y - (base.y - top) * 0.45 : top + (base.y - top) * (0.3 + 0.35 * (1 + Math.sin(a)) * 0.5)) + oy
        blob(ctx, base.x + ox, y, r * 0.55, r * (p.species === 'salat' ? 0.42 : 0.32), k % 2 ? dark : mid)
      }
      blob(ctx, base.x, top + r * 0.3, r * 0.5, r * 0.35, mid)
      blob(ctx, base.x - r * 0.15, top + r * 0.2, r * 0.28, r * 0.18, light)
      break
    }
    case 'tomate': {
      const hM = 0.25 + 1.5 * Math.sqrt(g)
      const top = proj(wx, BED_H + hM, wz)
      const stake = proj(wx + 0.05, BED_H + Math.max(0.6, hM + 0.1), wz)
      ctx.strokeStyle = '#a0825a'
      ctx.lineWidth = Math.max(0.6, px(0.025, wz))
      ctx.beginPath()
      ctx.moveTo(base.x + px(0.05, wz), base.y)
      ctx.lineTo(stake.x, stake.y)
      ctx.stroke()
      const r = px(0.18 * (0.4 + 0.6 * Math.sqrt(g)), wz)
      const n = 4 + Math.round(g * 6)
      for (let k = 0; k < n; k++) {
        const t = k / n
        const y = base.y + (top.y - base.y) * (0.15 + 0.85 * t)
        const side = k % 2 ? 1 : -1
        blob(ctx, base.x + side * r * (0.5 + droop * 0.3), y + droop * r * 0.4, r * 0.75, r * 0.4, k % 3 ? mid : dark)
      }
      blob(ctx, top.x, top.y, r * 0.5, r * 0.35, light)
      const fruits = Math.min(10, Math.floor(p.fruit / 80))
      const rr = seeded(p.id)
      for (let f = 0; f < fruits; f++) {
        const t = 0.2 + rr() * 0.55
        blob(ctx, base.x + (rr() - 0.5) * r * 1.6, base.y + (top.y - base.y) * t, Math.max(1, px(0.035, wz)), Math.max(1, px(0.035, wz)), f < fruits * 0.6 ? '#d4302a' : '#8fbf4a')
      }
      break
    }
  }
}

function drawEmptySection(ctx: CanvasRenderingContext2D, bed: number, i: number) {
  const cx = BED_X[bed]
  const col = i % SEC_ACROSS
  const row = Math.floor(i / SEC_ACROSS)
  const x0 = cx - BED_W / 2 + 0.08 + (col * (BED_W - 0.16)) / SEC_ACROSS
  const w = (BED_W - 0.16) / SEC_ACROSS
  const len = (BED_Z1 - BED_Z0) / SEC_ALONG
  const z0 = BED_Z0 + row * len
  ctx.fillStyle = 'rgba(70,80,80,0.45)'
  for (let b = 0; b < 6; b++)
    for (let a = 0; a < 3; a++) {
      const z = z0 + ((b + 0.5) * len) / 6
      const p = proj(x0 + ((a + 0.5) * w) / 3, BED_H, z)
      const r = px(0.025, z)
      if (r < 0.4) continue
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, r, r * 0.4, 0, 0, Math.PI * 2)
      ctx.fill()
    }
}

function drawStatic(ctx: CanvasRenderingContext2D, s: GameState, selected: number) {
  drawTunnel(ctx)
  const wilt = clamp((s.dryHours - 3) / 24)
  // Beete von außen nach innen, damit die mittleren vorne liegen
  const order = Array.from({ length: s.equip.beds }, (_, i) => i).sort((a, b) => Math.abs(BED_X[b]) - Math.abs(BED_X[a]))
  for (const b of order) {
    drawBedFrame(ctx, b)
    for (let row = SEC_ALONG - 1; row >= 0; row--)
      for (let col = 0; col < SEC_ACROSS; col++) {
        const i = row * SEC_ACROSS + col
        const slot = b * SLOTS_PER_BED + i
        const p = s.slots[slot]
        if (!p) drawEmptySection(ctx, b, i)
        else for (const h of sectionHeads(b, i, p)) drawHead(ctx, p, h.x, h.z, h.j, wilt)
        if (slot === selected) {
          ctx.strokeStyle = '#ffcf33'
          ctx.lineWidth = 2.5
          quadPath(ctx, sectionQuad(b, i))
          ctx.stroke()
        }
      }
  }
}

// ===================== Dynamische Ebene: Becken, Fische, Rohre =====================

function steelLine(ctx: CanvasRenderingContext2D, a: P2, b: P2, width: number) {
  const w = Math.max(1.5, width)
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#7d878d'
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.strokeStyle = '#b9c2c7'
  ctx.lineWidth = w * 0.6
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = w * 0.18
  ctx.beginPath()
  ctx.moveTo(a.x, a.y - w * 0.22)
  ctx.lineTo(b.x, b.y - w * 0.22)
  ctx.stroke()
  ctx.lineCap = 'butt'
}

function steelCylinder(ctx: CanvasRenderingContext2D, x: number, z: number, r: number, h: number) {
  const top = proj(x, h, z)
  const bot = proj(x, 0, z)
  const rx = px(r, z)
  const ry = rx * 0.32
  const g = ctx.createLinearGradient(top.x - rx, 0, top.x + rx, 0)
  g.addColorStop(0, '#8a949a')
  g.addColorStop(0.35, '#eef2f4')
  g.addColorStop(0.6, '#b4bec4')
  g.addColorStop(1, '#6f797f')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(top.x - rx, top.y)
  ctx.lineTo(bot.x - rx, bot.y)
  ctx.ellipse(bot.x, bot.y, rx, ry, 0, Math.PI, 0, true)
  ctx.lineTo(top.x + rx, top.y)
  ctx.fill()
  ctx.fillStyle = '#d5dbde'
  ctx.beginPath()
  ctx.ellipse(top.x, top.y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#8a949a'
  ctx.lineWidth = 1
  ctx.stroke()
  // Bänder
  for (const t of [0.25, 0.75]) {
    const y = top.y + (bot.y - top.y) * t
    ctx.strokeStyle = 'rgba(80,90,96,0.5)'
    ctx.beginPath()
    ctx.ellipse(top.x, y, rx, ry, 0, 0, Math.PI)
    ctx.stroke()
  }
}

// Fische als bewegte Figuren (nur Darstellung)
interface Sprite {
  group: number
  tank: number
  /** Position im Becken: Einheitskreis */
  u: number
  v: number
  /** 0 = Oberfläche, 1 = Boden */
  d: number
  heading: number
  turn: number
  phase: number
  dTarget: number
}
const sprites: Sprite[] = []
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function syncSprites(s: GameState, nTanks: number) {
  const total = s.fish.reduce((a, g) => a + g.count, 0)
  const cap = 34 * nTanks
  const scale = total > cap ? cap / total : 1
  const want = new Map<number, number>()
  for (const g of s.fish) want.set(g.id, Math.max(1, Math.round(g.count * scale)))
  const have = new Map<number, number>()
  for (let i = sprites.length - 1; i >= 0; i--) {
    const sp = sprites[i]
    const n = have.get(sp.group) ?? 0
    if (n >= (want.get(sp.group) ?? 0) || sp.tank >= nTanks) {
      sprites.splice(i, 1)
      continue
    }
    have.set(sp.group, n + 1)
  }
  let k = sprites.length
  for (const g of s.fish) {
    for (let i = have.get(g.id) ?? 0; i < (want.get(g.id) ?? 0); i++) {
      const a = rand(0, Math.PI * 2)
      const r = Math.sqrt(rand(0, 0.8))
      sprites.push({ group: g.id, tank: k++ % nTanks, u: Math.cos(a) * r, v: Math.sin(a) * r, d: rand(0.1, 0.9), heading: a + Math.PI / 2, turn: 0, phase: rand(0, 6), dTarget: rand(0.1, 0.9) })
    }
  }
}

function fishLenM(g: FishGroup) {
  return 0.05 * Math.cbrt(g.weight)
}

function drawFishTop(ctx: CanvasRenderingContext2D, g: FishGroup, x: number, y: number, len: number, heading: number, squash: number, time: number, phase: number, fade: number, dead = false) {
  const f = FISH[g.species]
  const sick = g.health < 40
  const wag = Math.sin(time * (sick ? 5 : 11) + phase) * 0.35
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, squash)
  ctx.rotate(heading)
  ctx.globalAlpha = fade
  const wid = len * (g.species === 'karpfen' ? 0.24 : g.species === 'wels' ? 0.16 : 0.2)
  // Schwanz
  ctx.fillStyle = dead ? '#cfc9bd' : f.fin
  ctx.beginPath()
  ctx.moveTo(-len * 0.38, 0)
  ctx.lineTo(-len * 0.56, -wid * 0.9 + wag * wid)
  ctx.lineTo(-len * 0.56, wid * 0.9 + wag * wid)
  ctx.closePath()
  ctx.fill()
  // Körper
  ctx.fillStyle = dead ? '#ece8e0' : f.body
  ctx.beginPath()
  ctx.ellipse(0, 0, len * 0.42, wid, 0, 0, Math.PI * 2)
  ctx.fill()
  if (!dead) {
    // Rückenlinie dunkler, Flanken heller
    ctx.fillStyle = 'rgba(30,40,45,0.35)'
    ctx.beginPath()
    ctx.ellipse(-len * 0.03, 0, len * 0.34, wid * 0.35, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath()
    ctx.ellipse(len * 0.05, -wid * 0.55, len * 0.25, wid * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    if (g.species === 'forelle') {
      ctx.fillStyle = 'rgba(214,90,120,0.6)'
      ctx.fillRect(-len * 0.3, wid * 0.45, len * 0.6, wid * 0.25)
    }
    // Brustflossen
    ctx.fillStyle = f.fin
    ctx.beginPath()
    ctx.ellipse(len * 0.15, wid * 0.95, len * 0.08, wid * 0.3, 0.6, 0, Math.PI * 2)
    ctx.ellipse(len * 0.15, -wid * 0.95, len * 0.08, wid * 0.3, -0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function drawTank(ctx: CanvasRenderingContext2D, s: GameState, t: Tank, index: number, time: number, dt: number, running: boolean) {
  const w = s.water
  const top = proj(t.x, TANK_H, t.z)
  const bot = proj(t.x, 0, t.z)
  const rx = px(t.r, t.z)
  const near = proj(t.x, TANK_H, t.z - t.r).y
  const far = proj(t.x, TANK_H, t.z + t.r).y
  const ry = (near - far) / 2
  const cy = (near + far) / 2
  const bNear = proj(t.x, 0, t.z - t.r).y
  const bFar = proj(t.x, 0, t.z + t.r).y
  const bry = (bNear - bFar) / 2
  const bcy = (bNear + bFar) / 2
  const surfaceY = cy + ry * 0.06

  // Schatten
  blob(ctx, bot.x, bcy + 4, rx * 1.05, bry * 1.1, 'rgba(60,55,45,0.25)')

  // Wasserfarbe
  const turb = clamp(w.solids / 600)
  const algae = clamp((w.no3 - 20) / 200) * 0.5
  const tint = (c: [number, number, number]) => {
    const algaeC: [number, number, number] = [96, 150, 80]
    const mudC: [number, number, number] = [130, 110, 70]
    const m = c.map((v, i) => v + (algaeC[i] - v) * algae).map((v, i) => v + (mudC[i] - v) * turb * 0.7)
    return m
  }
  const rgb = (c: number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
  const deep = tint([45, 150, 188])
  const shallow = tint([90, 200, 215])

  // Wasserkörper (Innenraum: Fläche oben + Glasfront)
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(top.x, cy, rx, ry, 0, Math.PI, 0)
  ctx.lineTo(top.x + rx, bcy)
  ctx.ellipse(bot.x, bcy, rx, bry, 0, 0, Math.PI)
  ctx.closePath()
  ctx.clip()
  const wg = ctx.createLinearGradient(0, far, 0, bNear)
  wg.addColorStop(0, rgb(shallow))
  wg.addColorStop(0.45, rgb(deep))
  wg.addColorStop(1, rgb(tint([34, 112, 150])))
  ctx.fillStyle = wg
  ctx.fillRect(top.x - rx - 2, far - 2, rx * 2 + 4, bNear - far + 4)
  // Innenwand hinten
  ctx.fillStyle = 'rgba(40,130,190,0.35)'
  ctx.beginPath()
  ctx.ellipse(top.x, cy, rx * 0.98, ry * 0.95, 0, Math.PI, 0)
  ctx.ellipse(bot.x, bcy, rx * 0.98, bry * 0.95, 0, 0, Math.PI, true)
  ctx.fill()
  // Boden
  ctx.fillStyle = rgb(tint([40, 110, 140]), 0.7)
  ctx.beginPath()
  ctx.ellipse(bot.x, bcy, rx * 0.97, bry * 0.95, 0, 0, Math.PI * 2)
  ctx.fill()
  if (w.solids > 30) {
    ctx.fillStyle = `rgba(80,62,40,${clamp(w.solids / 800, 0, 0.6)})`
    ctx.beginPath()
    ctx.ellipse(bot.x, bcy, rx * 0.5, bry * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Fische
  const byId = new Map(s.fish.map((g) => [g.id, g]))
  const gasp = w.o2 < 2.5
  const feeding = w.floatingFeed > 0.2
  const mine = sprites.filter((sp) => sp.tank === index).sort((a, b) => b.d - a.d)
  const depthPx = bNear - near
  for (const sp of mine) {
    const g = byId.get(sp.group)
    if (!g) continue
    // Bewegung: Kreisströmung plus etwas Zufall
    const speed = (g.health < 40 ? 0.12 : 0.35) * (running ? 1 : 0.5)
    sp.turn += (rand(-1, 1) * 2 - sp.turn) * dt * 0.8
    const rr = Math.hypot(sp.u, sp.v)
    const flow = Math.atan2(sp.v, sp.u) + Math.PI / 2
    let target = flow + sp.turn * 0.6
    if (rr > 0.82) target = Math.atan2(-sp.v, -sp.u) // zurück zur Mitte
    let diff = target - sp.heading
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    sp.heading += diff * Math.min(1, dt * 2.2)
    sp.u += Math.cos(sp.heading) * speed * dt
    sp.v += Math.sin(sp.heading) * speed * dt
    const r2 = Math.hypot(sp.u, sp.v)
    if (r2 > 0.9) {
      sp.u *= 0.9 / r2
      sp.v *= 0.9 / r2
    }
    if (Math.random() < dt * 0.25) sp.dTarget = g.species === 'wels' || g.species === 'karpfen' ? rand(0.4, 1) : rand(0.05, 0.95)
    const dWant = gasp || feeding ? 0.02 : sp.dTarget
    sp.d += (dWant - sp.d) * Math.min(1, dt * 0.8)

    const x = top.x + sp.u * rx
    const ySurf = surfaceY + sp.v * ry
    // Je tiefer, desto weiter unten durch die Glasfront sichtbar
    const y = ySurf + sp.d * depthPx * (0.35 + 0.65 * Math.max(0, sp.v + 0.2))
    const lenPx = px(fishLenM(g), t.z + sp.v * t.r * 0.8)
    const fade = 1 - sp.d * 0.35
    drawFishTop(ctx, g, x, y, lenPx, Math.atan2(Math.sin(sp.heading) * 0.55, Math.cos(sp.heading)), 1, time, sp.phase, fade)
  }
  // Tiefenschleier
  const veil = ctx.createLinearGradient(0, near, 0, bNear)
  veil.addColorStop(0, rgb(deep, 0))
  veil.addColorStop(1, rgb(deep, 0.15))
  ctx.fillStyle = veil
  ctx.fillRect(top.x - rx, near, rx * 2, bNear - near)
  ctx.restore()

  // Wasseroberfläche: Glanz, Wellen, Schaum
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(top.x, surfaceY, rx * 0.97, ry * 0.95, 0, 0, Math.PI * 2)
  ctx.clip()
  const sg = ctx.createRadialGradient(top.x - rx * 0.3, surfaceY - ry * 0.3, 2, top.x, surfaceY, rx)
  sg.addColorStop(0, 'rgba(255,255,255,0.25)')
  sg.addColorStop(1, 'rgba(255,255,255,0.02)')
  ctx.fillStyle = sg
  ctx.fillRect(top.x - rx, surfaceY - ry, rx * 2, ry * 2)
  // Schatten der Beckenwand auf dem Wasser (hinterer Rand)
  const rim = ctx.createLinearGradient(0, surfaceY - ry, 0, surfaceY - ry * 0.55)
  rim.addColorStop(0, 'rgba(10,50,80,0.45)')
  rim.addColorStop(1, 'rgba(10,50,80,0)')
  ctx.fillStyle = rim
  ctx.fillRect(top.x - rx, surfaceY - ry, rx * 2, ry * 0.5)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  for (let k = 0; k < 9; k++) {
    const a = time * 0.5 + k * 0.7
    const rr = 0.2 + ((k * 0.13 + time * 0.03) % 0.75)
    ctx.beginPath()
    ctx.ellipse(top.x, surfaceY, rx * rr, ry * rr, 0, a, a + 0.6)
    ctx.stroke()
  }
  // Einlauf mit Schaum
  if (s.equip.pumpOn) {
    const ix = top.x + rx * 0.35
    const iy = surfaceY - ry * 0.55
    for (let k = 0; k < 26; k++) {
      const a = k * 2.4 + time * 2
      const rr = ((k * 0.37 + time * 0.8) % 1) * rx * 0.35
      blob(ctx, ix + Math.cos(a) * rr, iy + Math.sin(a) * rr * 0.4, 2 + (k % 3), 1.2 + (k % 2), 'rgba(255,255,255,0.7)')
    }
  }
  // Luftsprudler
  const air = s.equip.airPump
  for (let k = 0; k < air * 18; k++) {
    const a = (k * 137.5 * Math.PI) / 180
    const rr = Math.sqrt((k % 18) / 18) * 0.55
    const flick = (Math.sin(time * 9 + k) + 1) / 2
    blob(ctx, top.x - rx * 0.2 + Math.cos(a) * rr * rx, surfaceY + ry * 0.1 + Math.sin(a) * rr * ry, 1 + flick * 2, 0.8 + flick, `rgba(255,255,255,${0.35 + flick * 0.4})`)
  }
  // Futter
  if (index === 0) {
    const pellets = Math.min(50, Math.round(w.floatingFeed * 2))
    for (let k = 0; k < pellets; k++) {
      const a = k * 2.39996
      const rr = Math.sqrt(k / 50) * 0.5
      blob(ctx, top.x + Math.cos(a) * rr * rx, surfaceY + Math.sin(a) * rr * ry, 1.6, 1.2, '#7a4b1e')
    }
    // Tote Fische treiben oben
    const dead = Math.min(10, w.deadCount)
    for (let k = 0; k < dead; k++) {
      const a = k * 1.9 + 0.5
      const g = s.fish[0] ?? ({ species: 'karpfen', health: 0, weight: 200 } as FishGroup)
      drawFishTop(ctx, g, top.x + Math.cos(a) * 0.55 * rx, surfaceY + Math.sin(a) * 0.55 * ry, px(0.25, t.z), a, 0.6, 0, 0, 1, true)
    }
  }
  ctx.restore()

  // Glasfront: Spiegelung
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(top.x, cy, rx, ry, 0, 0, Math.PI)
  ctx.lineTo(bot.x - rx, bcy)
  ctx.ellipse(bot.x, bcy, rx, bry, 0, Math.PI, 0, true)
  ctx.closePath()
  ctx.clip()
  const gl = ctx.createLinearGradient(top.x - rx, 0, top.x + rx, 0)
  gl.addColorStop(0, 'rgba(255,255,255,0.18)')
  gl.addColorStop(0.2, 'rgba(255,255,255,0.0)')
  gl.addColorStop(0.75, 'rgba(255,255,255,0.0)')
  gl.addColorStop(0.85, 'rgba(255,255,255,0.22)')
  gl.addColorStop(1, 'rgba(255,255,255,0.05)')
  ctx.fillStyle = gl
  ctx.fillRect(top.x - rx, far, rx * 2, bNear - far)
  ctx.restore()

  // Blauer Rand oben (undurchsichtiges Band) und Fuß
  const band = px(0.14, t.z - t.r)
  ctx.fillStyle = '#1f7fc0'
  ctx.beginPath()
  ctx.ellipse(top.x, cy, rx, ry, 0, 0, Math.PI)
  ctx.lineTo(top.x - rx, cy + band)
  ctx.ellipse(top.x, cy + band, rx, ry, 0, Math.PI, 0, true)
  ctx.closePath()
  ctx.fill()
  const bandG = ctx.createLinearGradient(top.x - rx, 0, top.x + rx, 0)
  bandG.addColorStop(0, 'rgba(0,0,0,0.25)')
  bandG.addColorStop(0.35, 'rgba(255,255,255,0.18)')
  bandG.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = bandG
  ctx.fill()
  ctx.strokeStyle = '#2a95d6'
  ctx.lineWidth = Math.max(2, px(0.06, t.z))
  ctx.beginPath()
  ctx.ellipse(top.x, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#1b6aa3'
  ctx.lineWidth = Math.max(2, px(0.05, t.z))
  ctx.beginPath()
  ctx.ellipse(bot.x, bcy, rx, bry, 0, 0, Math.PI)
  ctx.stroke()
  // Seitenkanten
  ctx.strokeStyle = 'rgba(30,110,170,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(top.x - rx, cy)
  ctx.lineTo(bot.x - rx, bcy)
  ctx.moveTo(top.x + rx, cy)
  ctx.lineTo(bot.x + rx, bcy)
  ctx.stroke()

  // Heizstab-Anzeige
  if (s.equip.heater) {
    const heating = s.equip.heaterOn && w.temp < s.equip.heaterSet - 0.05
    blob(ctx, top.x + rx * 0.82, cy + band * 0.5 + ry * 0.4, 3, 3, heating ? '#ff8a3d' : '#5a6870')
  }
}

function drawPlumbing(ctx: CanvasRenderingContext2D, s: GameState, list: Tank[], time: number, behind: boolean) {
  const pipeY = TANK_H + 0.35
  const zMan = 6.25
  if (behind) {
    // Hauptleitung zu den Beeten (Boden, Mitte)
    steelLine(ctx, proj(0, 0.15, 6.2), proj(0, 0.15, BED_Z0 - 0.2), px(0.16, 7))
    for (let b = 0; b < s.equip.beds; b++) steelLine(ctx, proj(0, 0.15, BED_Z0 - 0.2), proj(BED_X[b], 0.15, BED_Z0 - 0.2), px(0.12, BED_Z0))
    // Biofilter
    steelCylinder(ctx, -0.5, 6.4, 0.3, 1.7)
    steelCylinder(ctx, 0.5, 6.4, 0.3, 1.7)
    return
  }
  // Querleitung über den Becken
  if (list.length > 1) {
    steelLine(ctx, proj(list[0].x - 0.6, pipeY, zMan), proj(list[list.length - 1].x + 0.6, pipeY, zMan), px(0.14, zMan))
  } else {
    steelLine(ctx, proj(list[0].x + 0.4, pipeY, zMan), proj(0.6, pipeY, zMan), px(0.14, zMan))
  }
  for (const t of list) {
    if (t.z > 6) continue
    const nozzle = proj(t.x + t.r * 0.35, pipeY, t.z + t.r * 0.55)
    const surf = proj(t.x + t.r * 0.35, TANK_H - 0.04, t.z + t.r * 0.55)
    steelLine(ctx, proj(t.x + t.r * 0.35, pipeY, zMan), nozzle, px(0.1, t.z))
    if (s.equip.pumpOn) {
      ctx.strokeStyle = 'rgba(200,235,250,0.85)'
      ctx.lineWidth = Math.max(2, px(0.07, t.z))
      ctx.setLineDash([5, 4])
      ctx.lineDashOffset = -time * 40
      ctx.beginPath()
      ctx.moveTo(nozzle.x, nozzle.y)
      ctx.lineTo(surf.x, surf.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  // Steigleitung mit Pumpe in der Mitte
  steelLine(ctx, proj(0, 0.1, zMan), proj(0, pipeY, zMan), px(0.16, zMan))
  const pump = proj(0, 0.25, zMan - 0.3)
  const sz = px(0.4, zMan)
  ctx.fillStyle = '#2c3439'
  ctx.fillRect(pump.x - sz / 2, pump.y - sz / 2, sz, sz * 0.8)
  ctx.fillStyle = '#2a6fd6'
  ctx.fillRect(pump.x - sz / 2, pump.y - sz / 2, sz, sz * 0.25)
  blob(ctx, pump.x + sz * 0.3, pump.y + sz * 0.1, 2.5, 2.5, s.equip.pumpOn ? '#62d26f' : '#d04a3f')
}

// --- Zusammensetzen ---

let staticCanvas: HTMLCanvasElement | null = null
let staticKey = ''
let lastTime = 0

function stateKey(s: GameState, selected: number, scale: number) {
  let k = `${s.equip.beds}|${s.equip.tankLevel}|${selected}|${scale}|${Math.round(s.dryHours)}`
  for (const p of s.slots) k += p ? `|${p.id}:${Math.round(Math.sqrt(p.mass) * 3)}:${Math.round(p.health / 10)}:${Math.round(p.chlorosis * 6)}:${Math.round(p.nDeficit * 5)}:${Math.floor(p.fruit / 80)}:${p.dead ? 1 : 0}` : '|-'
  return k
}

/** Zeichnet ein Bild. `time` in Sekunden (Echtzeit) für Animationen. */
export function drawScene(ctx: CanvasRenderingContext2D, s: GameState, time: number, selectedSlot: number, running: boolean) {
  const dt = Math.min(0.1, Math.max(0, time - lastTime))
  lastTime = time
  const scale = ctx.getTransform().a

  // Statische Ebene nur neu zeichnen, wenn sich Pflanzen oder Aufbau ändern
  const key = stateKey(s, selectedSlot, scale)
  if (!staticCanvas || key !== staticKey) {
    staticKey = key
    if (!staticCanvas) staticCanvas = document.createElement('canvas')
    staticCanvas.width = Math.round(W * scale)
    staticCanvas.height = Math.round(H * scale)
    const sc = staticCanvas.getContext('2d')!
    sc.setTransform(scale, 0, 0, scale, 0, 0)
    drawStatic(sc, s, selectedSlot)
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(staticCanvas, 0, 0)
  ctx.restore()

  const list = tanks(s)
  syncSprites(s, list.length)
  drawPlumbing(ctx, s, list, time, true)
  list.forEach((t, i) => {
    drawTank(ctx, s, t, i, time, dt, running)
  })
  drawPlumbing(ctx, s, list, time, false)

  // Tageslicht
  const light = currentLight(s)
  const night = 1 - clamp(light * 2.5)
  if (night > 0) {
    ctx.fillStyle = `rgba(8,16,40,${night * 0.55})`
    ctx.fillRect(0, 0, W, H)
  }
}
