// Profi-Technik im Gewächshaus: Filter, MBBR, Entgaser, UV, Sauerstoff, Notstrom,
// Mineralisierer, Dosierung, Heizung, Lüftung, Schattierung, LED und Insektennetz.
// Wird neu aufgebaut, sobald sich die Ausstattung ändert.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp } from '../sim/chemistry.ts'
import { SLUDGE_CAP } from '../sim/data.ts'
import { aeration, hasPower } from '../sim/simulate.ts'
import type { GameState } from '../sim/state.ts'

export interface EquipLayout {
  bedX: number[]
  bedW: number
  bedD0: number
  bedD1: number
  tankH: number
  half: number
  wall: number
  start: number
  end: number
}

type Anim = (s: GameState, time: number, dt: number) => void

const V = (x: number, y: number, d: number) => new THREE.Vector3(x, y, -d)

function signature(s: GameState) {
  const e = s.equip
  return [e.mechFilter, e.mbbr, e.degasser, e.uv, e.oxygen, e.generator, e.batteryAir, e.mineralizer, e.doser, e.airHeater, e.climate, e.led, e.insectNet, e.beds, e.tankLevel]
    .map((v) => Number(v))
    .join(',')
}

export class EquipmentView {
  readonly group = new THREE.Group()
  private sig = ''
  private anims: Anim[] = []
  private L: EquipLayout
  private steel: THREE.Material
  private dot: THREE.Texture
  private waterNormals: THREE.Texture
  private mats: Record<string, THREE.MeshStandardMaterial>

  constructor(L: EquipLayout, steel: THREE.Material, dot: THREE.Texture, waterNormals: THREE.Texture) {
    this.L = L
    this.steel = steel
    this.dot = dot
    this.waterNormals = waterNormals
    const m = (color: string, rough = 0.5, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
    this.mats = {
      white: m('#e6eaea', 0.45),
      grey: m('#5d676d', 0.5),
      dark: m('#262d32', 0.45),
      blue: m('#1f80c6', 0.35),
      green: m('#3f6e3a', 0.5),
      red: m('#b8392e', 0.45),
      yellow: m('#d9b13a', 0.5),
      wood: m('#a27d50', 0.9),
      brown: m('#5b4128', 0.8),
    }
  }

  update(s: GameState, time: number, dt: number) {
    const sig = signature(s)
    if (sig !== this.sig) {
      this.sig = sig
      this.rebuild(s)
    }
    for (const a of this.anims) a(s, time, dt)
  }

  // ---------- Bausteine ----------

  private add<T extends THREE.Object3D>(o: T, shadow = true): T {
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) c.castShadow = shadow
    })
    this.group.add(o)
    return o
  }

  private box(w: number, h: number, dep: number, mat: THREE.Material, x: number, y: number, d: number) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), mat)
    b.position.set(x, y, -d)
    return this.add(b)
  }

  private cyl(r: number, h: number, mat: THREE.Material, x: number, y: number, d: number, seg = 32, open = false) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, open), mat)
    c.position.set(x, y, -d)
    return this.add(c)
  }

  private pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material = this.steel) {
    const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 12)
    const m = new THREE.Mesh(g, mat)
    m.position.copy(a).add(b).multiplyScalar(0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    return this.add(m)
  }

  /** Rohr mit rechtwinkligen Bögen durch mehrere Punkte */
  private run(pts: THREE.Vector3[], r: number, mat?: THREE.Material) {
    for (let i = 1; i < pts.length; i++) this.pipe(pts[i - 1], pts[i], r, mat)
  }

  private glow(color: string) {
    return new THREE.MeshStandardMaterial({ color: '#222', emissive: color, emissiveIntensity: 0, roughness: 0.4 })
  }

  /** Wasseroberfläche mit bewegten Wellen */
  private surface(r: number, x: number, y: number, d: number, color: string) {
    const n = this.waterNormals.clone()
    n.repeat.set(1.5, 1.5)
    const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, normalMap: n, normalScale: new THREE.Vector2(0.8, 0.8) })
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, y, -d)
    this.group.add(m)
    return m
  }

  /** Aufsteigende Luftblasen in einem runden Behälter */
  private bubbles(n: number, x: number, d: number, r: number, y0: number, y1: number, size: number, color: string, on: (s: GameState) => boolean, swirl = 0) {
    const pos = new Float32Array(n * 3)
    const pts = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ map: this.dot, color, size, transparent: true, depthWrite: false, opacity: 0.85 }),
    )
    pts.frustumCulled = false
    this.group.add(pts)
    const seeds = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()])
    this.anims.push((s, time) => {
      pts.visible = on(s)
      if (!pts.visible) return
      const attr = pts.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < n; i++) {
        const [a, b, c] = seeds[i]
        const prog = (b + time * (0.3 + a * 0.3)) % 1
        const ang = c * Math.PI * 2 + time * swirl * (0.5 + a)
        const rad = Math.sqrt(a) * r * 0.9
        attr.setXYZ(i, x + Math.cos(ang) * rad, y0 + prog * (y1 - y0), -d + Math.sin(ang) * rad)
      }
      attr.needsUpdate = true
    })
    return pts
  }

  /** Ventilator mit drehenden Flügeln; Achse zeigt in Richtung `dir` */
  private fan(r: number, pos: THREE.Vector3, dir: THREE.Vector3, spin: (s: GameState) => number) {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.08, 8, 32), this.mats.grey)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.15, r * 0.15, r * 0.3, 12), this.mats.dark)
    hub.rotation.x = Math.PI / 2
    const blades = new THREE.Group()
    for (let k = 0; k < 4; k++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.85, 0.01), this.mats.dark)
      bl.position.y = r * 0.48
      bl.rotation.y = 0.35
      const arm = new THREE.Group()
      arm.rotation.z = (k * Math.PI) / 2
      arm.add(bl)
      blades.add(arm)
    }
    const grill = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: '#333', wireframe: true }))
    grill.position.z = r * 0.12
    g.add(ring, hub, blades, grill)
    g.position.copy(pos)
    g.lookAt(pos.clone().add(dir))
    this.add(g, false)
    this.anims.push((s, _t, dt) => {
      blades.rotation.z += spin(s) * dt * 18
    })
    return g
  }

  // ---------- Aufbau ----------

  private rebuild(s: GameState) {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
    this.group.clear()
    this.anims = []
    const e = s.equip
    const L = this.L
    const pumping = (g: GameState) => g.equip.pumpOn && hasPower(g)
    const tankX = -2
    const pipeY = L.tankH + 0.45

    // --- Feststofffilter links vorne ---
    if (e.mechFilter === 1) {
      const x = -5.3
      const d = 2.6
      this.cyl(0.6, 1.0, this.mats.white, x, 1.15, d)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.55, 32), this.mats.white)
      cone.rotation.x = Math.PI
      cone.position.set(x, 0.38, -d)
      this.add(cone)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2
        this.box(0.05, 0.7, 0.05, this.steel, x + Math.cos(a) * 0.5, 0.35, d + Math.sin(a) * 0.5)
      }
      const valve = this.box(0.18, 0.04, 0.04, this.mats.red, x + 0.18, 0.12, d)
      valve.rotation.y = 0.4
      this.pipe(V(x, 0.12, d), V(x + 0.1, 0.12, d), 0.04, this.mats.grey)
      const top = this.surface(0.58, x, 1.6, d, '#3a7f9a')
      const clean = new THREE.Color('#3a7f9a')
      const dirty = new THREE.Color('#6b5434')
      this.anims.push((g, time) => {
        const m = top.material as THREE.MeshPhysicalMaterial
        m.color.copy(clean).lerp(dirty, clamp(g.water.sludge / SLUDGE_CAP))
        m.normalMap!.offset.set(time * 0.01, time * 0.007)
      })
      this.run([V(tankX - 1.3, 0.3, d), V(x + 0.9, 0.3, d), V(x + 0.9, 1.0, d), V(x + 0.6, 1.0, d)], 0.055)
    } else if (e.mechFilter === 2) {
      const x = -5.3
      const d = 2.6
      this.box(1.5, 0.75, 0.95, this.steel, x, 0.55, d)
      for (const dx of [-0.65, 0.65])
        for (const dd of [-0.4, 0.4]) this.box(0.06, 0.2, 0.06, this.steel, x + dx, 0.1, d + dd)
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.25, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#4c6a5c', roughness: 0.6, side: THREE.DoubleSide, wireframe: false }))
      drum.rotation.z = Math.PI / 2
      drum.position.set(x, 0.95, -d)
      this.add(drum)
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.385, 0.385, 1.2, 24, 6, true), new THREE.MeshBasicMaterial({ color: '#9fb5aa', wireframe: true }))
      mesh.rotation.z = Math.PI / 2
      mesh.position.copy(drum.position)
      this.group.add(mesh)
      const lid = this.box(1.5, 0.04, 0.95, new THREE.MeshPhysicalMaterial({ color: '#d8eef5', transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false }), x, 1.36, d)
      lid.castShadow = false
      this.box(0.25, 0.3, 0.2, this.mats.dark, x - 0.85, 0.75, d)
      this.bubbles(40, x, d, 0.05, 1.2, 1.33, 0.03, '#ffffff', (g) => pumping(g) && Math.sin(g.t * 6) > 0.3)
      this.anims.push((g, _t, dt) => {
        if (pumping(g)) {
          drum.rotation.x += dt * 0.6
          mesh.rotation.x = drum.rotation.x
        }
      })
      this.run([V(tankX - 1.3, 0.3, d), V(x + 1.1, 0.3, d), V(x + 1.1, 0.7, d), V(x + 0.75, 0.7, d)], 0.055)
    }

    // --- MBBR-Biofilter rechts vorne ---
    for (let i = 0; i < e.mbbr; i++) {
      const x = 5.4
      const d = 1.6 + i * 1.7
      const r = 0.65
      const h = 1.35
      this.cyl(r, h, this.mats.white, x, h / 2, d, 40, true)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 40), this.mats.white)
      rim.rotation.x = Math.PI / 2
      rim.position.set(x, h, -d)
      this.add(rim)
      const top = this.surface(r - 0.02, x, h - 0.08, d, '#3d8aa0')
      this.anims.push((_g, time) => (top.material as THREE.MeshPhysicalMaterial).normalMap!.offset.set(time * 0.05, -time * 0.04))
      // Aufwirbelnde Füllkörper an der Oberfläche
      this.bubbles(70, x, d, r - 0.08, h - 0.1, h - 0.07, 0.07, '#e8d27a', () => true, 1.2)
      this.bubbles(60, x, d, r - 0.1, h - 0.09, h - 0.06, 0.05, '#ffffff', (g) => aeration(g) > 0, 2)
      this.run([V(x, h - 0.1, d), V(x, h + 0.2, d), V(4.55, h + 0.2, d)], 0.045)
      if (i === 0) this.box(0.4, 0.3, 0.3, this.mats.dark, x + 0.95, 0.15, d)
    }
    if (e.mbbr) {
      const y = 1.35 + 0.2
      this.run([V(4.55, y, 1.6), V(4.55, y, 4.6), V(0.35, y, 4.6), V(0.35, 1.0, 4.6)], 0.05)
    }

    // --- Rieselturm (Entgaser) ---
    if (e.degasser) {
      const x = 6.3
      const d = 8.0
      this.cyl(0.36, 2.0, this.mats.grey, x, 1.0 + 0.35, d)
      this.cyl(0.55, 0.35, this.mats.white, x, 0.175, d)
      this.cyl(0.4, 0.06, this.mats.dark, x, 2.38, d)
      this.fan(0.25, V(x, 2.45, d), new THREE.Vector3(0, 1, 0), (g) => (hasPower(g) ? 1.6 : 0))
      this.run([V(x + 0.55, 0.12, d - 0.5), V(x + 0.55, 2.2, d - 0.5), V(x, 2.2, d - 0.5), V(x, 2.2, d)], 0.045)
      this.run([V(x - 0.5, 0.12, d), V(0.1, 0.12, d)], 0.06)
    }

    // --- UV-Klärer an der linken Wand ---
    if (e.uv) {
      const x = -6.9
      const d = 4.3
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 20), this.steel)
      tube.rotation.x = Math.PI / 2
      tube.position.set(x, 1.15, -d)
      this.add(tube)
      const win = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.12, 20, 1, true), this.glow('#7a5cff'))
      win.rotation.x = Math.PI / 2
      win.position.copy(tube.position)
      this.group.add(win)
      this.box(0.12, 0.18, 0.08, this.mats.dark, x + 0.12, 1.45, d - 0.3)
      this.run([V(x, 1.15, d - 0.5), V(x, 1.15, d - 0.8), V(-3.6, 1.15, d - 0.8), V(-3.6, pipeY, d - 0.8)], 0.04)
      this.run([V(x, 1.15, d + 0.5), V(x, 0.12, d + 0.5)], 0.04)
      this.anims.push((g) => ((win.material as THREE.MeshStandardMaterial).emissiveIntensity = pumping(g) ? 2.5 : 0))
    }

    // --- Sauerstoff: Konzentrator und Kegel ---
    if (e.oxygen) {
      const x = -6.6
      const d = 5.9
      this.box(0.45, 0.75, 0.4, this.mats.white, x, 0.375, d)
      const led = this.box(0.06, 0.06, 0.02, this.glow('#3dff6a'), x + 0.1, 0.62, d - 0.21)
      led.castShadow = false
      this.box(0.3, 0.12, 0.02, this.mats.dark, x - 0.05, 0.5, d - 0.21)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 32), this.steel)
      cone.rotation.x = Math.PI
      cone.position.set(x + 0.8, 0.95, -d)
      this.add(cone)
      this.cyl(0.08, 0.3, this.steel, x + 0.8, 1.6, d, 16)
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2
        this.box(0.04, 0.5, 0.04, this.steel, x + 0.8 + Math.cos(a) * 0.15, 0.25, d + Math.sin(a) * 0.15)
      }
      this.run([V(x + 0.8, 1.75, d), V(x + 0.8, pipeY + 0.1, d), V(-2, pipeY + 0.1, d), V(-2, pipeY + 0.1, 3.9), V(-2, 0.3, 3.9)], 0.025, this.mats.grey)
      this.anims.push((g) => ((led.material as THREE.MeshStandardMaterial).emissiveIntensity = g.equip.oxygenOn && hasPower(g) ? 2 : 0))
    }

    // --- Dosierstation an der linken Wand ---
    if (e.doser) {
      const x = -7.4
      const d = 7.5
      this.box(0.25, 0.9, 0.7, this.mats.grey, x, 1.3, d)
      const disp = this.box(0.02, 0.14, 0.24, this.glow('#4ad4ff'), x + 0.13, 1.5, d)
      disp.castShadow = false
      const cans: [string, number][] = [
        ['#2b6fc9', -0.25],
        ['#efefef', 0.05],
        ['#7a4a1c', 0.35],
      ]
      for (const [c, dd] of cans) {
        this.box(0.24, 0.38, 0.22, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 }), x + 0.35, 0.19, d + dd)
        this.cyl(0.04, 0.05, this.mats.dark, x + 0.35, 0.405, d + dd, 10)
      }
      this.run([V(x + 0.13, 1.0, d - 0.2), V(x + 0.5, 1.0, d - 0.2), V(x + 0.5, 1.0, 6.4), V(-3.3, 1.0, 6.4)], 0.015, this.mats.dark)
      this.anims.push((g) => ((disp.material as THREE.MeshStandardMaterial).emissiveIntensity = g.equip.doserOn && hasPower(g) ? 1.6 : 0.1))
    }

    // --- Akku-Luftpumpe neben der Pumpe ---
    if (e.batteryAir) {
      const x = 0.5
      const d = 4.4
      this.box(0.32, 0.24, 0.22, this.mats.dark, x, 0.12, d)
      const led = this.box(0.04, 0.04, 0.02, this.glow('#3dff6a'), x + 0.08, 0.2, d - 0.115)
      led.castShadow = false
      const lm = led.material as THREE.MeshStandardMaterial
      this.anims.push((g, time) => {
        const out = g.outage > 0
        lm.emissive.set(out ? '#ffa020' : '#3dff6a')
        lm.emissiveIntensity = out ? (Math.sin(time * 6) > 0 ? 3 : 0.3) : 1.5
      })
    }

    // --- Hinten: Mineralisierer (IBC) und Notstromaggregat ---
    if (e.mineralizer) {
      const x = -3.6
      const d = 35.5
      this.box(1.1, 0.14, 1.3, this.mats.wood, x, 0.07, d)
      const tank = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.0, 1.2),
        new THREE.MeshPhysicalMaterial({ color: '#f2f2ea', transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false }),
      )
      tank.position.set(x, 0.66, -d)
      this.group.add(tank)
      const fill = this.box(0.94, 1, 1.14, this.mats.brown, x, 0.2, d)
      fill.castShadow = false
      const cage = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.04, 1.26, 3, 3, 3), new THREE.MeshBasicMaterial({ color: '#9aa1a5', wireframe: true }))
      cage.position.copy(tank.position)
      this.group.add(cage)
      this.cyl(0.12, 0.08, this.mats.dark, x, 1.2, d, 16)
      this.bubbles(40, x, d, 0.4, 0.2, 1.05, 0.04, '#e9e2cf', (g) => hasPower(g), 0.5)
      this.run([V(x + 0.5, 0.25, d - 0.6), V(x + 0.5, 0.12, d - 0.6), V(x + 0.5, 0.12, 8.6), V(0, 0.12, 8.6)], 0.04, this.mats.grey)
      this.anims.push((g) => {
        const f = clamp(0.15 + g.water.mineral / 2500, 0.15, 0.95)
        fill.scale.y = f
        fill.position.y = 0.17 + f / 2
      })
    }
    if (e.generator) {
      const x = 3.6
      const d = 36
      const body = new THREE.Group()
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.8), this.mats.green)
      b.position.y = 0.6
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.9), this.mats.dark)
      base.position.y = 0.06
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.02), this.mats.dark)
      panel.position.set(-0.4, 0.75, 0.41)
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.glow('#ff8a20'))
      lamp.position.set(-0.3, 0.82, 0.425)
      body.add(b, base, panel, lamp)
      body.position.set(x, 0, -d)
      this.add(body)
      this.run([V(x + 0.5, 1.07, d), V(x + 0.5, 2.1, d), V(L.half - 0.3, 2.1, d)], 0.05, this.mats.dark)
      const smoke = this.bubbles(30, L.half - 0.2, d, 0.15, 2.1, 3.2, 0.25, '#8a8a8a', (g) => g.outage > 0, 0.3)
      ;(smoke.material as THREE.PointsMaterial).opacity = 0.35
      this.anims.push((g, time) => {
        const run = g.outage > 0
        ;(lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = run ? 2.5 : 0
        body.position.x = x + (run ? Math.sin(time * 70) * 0.006 : 0)
      })
    }

    // --- Warmluftheizer unter dem Dach und Folienschlauch am First ---
    if (e.airHeater) {
      const d = 0.6
      const y = 3.9
      this.box(1.0, 0.65, 0.7, this.mats.red, 0, y, d)
      const grill = this.box(0.8, 0.45, 0.02, this.glow('#ff6a1a'), 0, y, d + 0.36)
      grill.castShadow = false
      this.pipe(V(-0.3, y + 0.33, d), V(-0.3, 5.9, d), 0.012, this.mats.dark)
      this.pipe(V(0.3, y + 0.33, d), V(0.3, 5.9, d), 0.012, this.mats.dark)
      const duct = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, L.bedD1 - d - 0.4, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: '#f2f6f8', transparent: true, opacity: 0.45, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      )
      duct.rotation.x = Math.PI / 2
      duct.position.set(0, y, -(d + 0.35 + (L.bedD1 - d - 0.4) / 2))
      this.group.add(duct)
      this.anims.push((g) => {
        const on = g.live.airHeating
        ;(grill.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.8 : 0
        const k = on ? 1 : 0.35
        duct.scale.x += (k - duct.scale.x) * 0.05
        duct.scale.z = duct.scale.x
      })
    }

    // --- Lüftung: Umluftventilatoren, Seitenlüftung und Schattiernetz ---
    if (e.climate) {
      for (const d of [11, 22, 31])
        for (const x of [-3.5, 3.5]) {
          const p = V(x, 3.4, d)
          this.pipe(V(x, 3.65, d), V(x, 4.4, d), 0.012, this.mats.dark)
          this.fan(0.32, p, new THREE.Vector3(0, 0, -1), (g) => (g.live.venting ? 1 : 0))
        }
      // Lüftungsrollen an den Seitenwänden
      const len = L.end - L.start - 2
      for (const sx of [-1, 1]) {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 10), this.mats.grey)
        roll.rotation.x = Math.PI / 2
        roll.position.set(sx * (L.half - 0.06), 0.4, -(L.start + L.end) / 2)
        this.add(roll, false)
        const vent = new THREE.Mesh(
          new THREE.PlaneGeometry(len, 1),
          new THREE.MeshStandardMaterial({ color: '#9bbf86', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
        )
        vent.rotation.y = Math.PI / 2
        vent.position.set(sx * (L.half - 0.02), 0.9, -(L.start + L.end) / 2)
        this.group.add(vent)
        this.anims.push((g) => {
          const target = g.live.venting ? 1.7 : 0.4
          roll.position.y += (target - roll.position.y) * 0.04
          const open = (roll.position.y - 0.4) / 1.3
          vent.visible = open > 0.02
          vent.scale.y = Math.max(0.01, open * 1.3)
          vent.position.y = 0.4 + (open * 1.3) / 2
        })
      }
      // Schattiernetz unter dem Dach
      const shade = new THREE.Mesh(
        new THREE.PlaneGeometry(12.2, L.bedD1 - 6),
        new THREE.MeshStandardMaterial({ color: '#2f3a33', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      )
      shade.rotation.x = -Math.PI / 2
      shade.position.set(0, 4.55, -((L.bedD1 + 6) / 2 + 1))
      this.group.add(shade)
      this.anims.push((g) => {
        const m = shade.material as THREE.MeshStandardMaterial
        m.opacity += ((g.live.shading ? 0.6 : 0) - m.opacity) * 0.04
        shade.visible = m.opacity > 0.01
      })
    }

    // --- LED-Pflanzenlampen über den Beeten ---
    if (e.led) {
      const housings: THREE.BufferGeometry[] = []
      const emit: THREE.BufferGeometry[] = []
      const wires: THREE.BufferGeometry[] = []
      const y = 2.9
      for (let b = 0; b < e.beds; b++)
        for (const dx of [-0.55, 0.55])
          for (let d = L.bedD0 + 1.2; d < L.bedD1 - 0.5; d += 2.4) {
            const x = L.bedX[b] + dx
            const h = new THREE.BoxGeometry(0.22, 0.07, 1.3)
            h.translate(x, y, -d)
            housings.push(h)
            const p = new THREE.PlaneGeometry(0.18, 1.24)
            p.rotateX(Math.PI / 2)
            p.translate(x, y - 0.037, -d)
            emit.push(p)
            const w = new THREE.CylinderGeometry(0.004, 0.004, 4.5 - y, 4)
            w.translate(x, (4.5 + y) / 2, -d)
            wires.push(w)
          }
      const hm = new THREE.Mesh(mergeGeometries(housings)!, this.mats.dark)
      const em = new THREE.Mesh(mergeGeometries(emit)!, new THREE.MeshStandardMaterial({ color: '#333', emissive: '#ff9de6', emissiveIntensity: 0, side: THREE.DoubleSide }))
      const wm = new THREE.Mesh(mergeGeometries(wires)!, this.mats.grey)
      this.add(hm)
      this.group.add(em, wm)
      // Schein auf den Pflanzen
      const glowLight = new THREE.HemisphereLight('#ff9de6', '#000000', 0)
      this.group.add(glowLight)
      this.anims.push((g) => {
        const on = g.live.ledActive
        ;(em.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.2 : 0
        glowLight.intensity = on ? 0.35 : 0
      })
    }

    // --- Insektenschutznetz an den Seiten ---
    if (e.insectNet) {
      const len = L.end - L.start
      for (const sx of [-1, 1]) {
        const net = new THREE.Mesh(
          new THREE.PlaneGeometry(len, L.wall - 0.1),
          new THREE.MeshStandardMaterial({ color: '#2a3a30', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
        )
        net.rotation.y = Math.PI / 2
        net.position.set(sx * (L.half - 0.1), (L.wall - 0.1) / 2, -(L.start + L.end) / 2)
        this.group.add(net)
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
  }
}
