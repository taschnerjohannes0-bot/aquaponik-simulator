// 3D-Ansicht der Anlage mit three.js: Folientunnel, Rundbecken mit Fischen,
// Biofilter, Edelstahlrohre und Schwimmbeete. Man kann durch das Gewächshaus gehen.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { clamp } from '../sim/chemistry.ts'
import { FISH, PLANTS, SLOTS_PER_BED, type PlantId } from '../sim/data.ts'
import { currentLight, plantMaxMass } from '../sim/simulate.ts'
import type { GameState, Plant } from '../sim/state.ts'

// --- Aufbau (Meter). "Tiefe" d zählt vom Eingang nach hinten, Welt-z = -d ---
const TUNNEL_HALF = 7.6
const TUNNEL_WALL = 2.3
const TUNNEL_APEX = 6.2
const TUNNEL_START = -6
const TUNNEL_END = 40
const BED_D0 = 9
const BED_D1 = 33
const BED_H = 0.85
const BED_W = 2.4
const BED_X = [-2, 2, -5, 5]
const SEC_ACROSS = 2
const SEC_ALONG = SLOTS_PER_BED / SEC_ACROSS
const TANK_H = 0.95
const MAX_BEDS = 4

interface TankDef {
  x: number
  d: number
  r: number
}

function tankLayout(level: number): TankDef[] {
  const front = [
    { x: -2, d: 3.2, r: 1.4 },
    { x: 2, d: 3.2, r: 1.4 },
  ]
  if (level === 0) return [front[0]]
  if (level === 1) return front
  return [{ x: -2, d: 6.4, r: 1.25 }, { x: 2, d: 6.4, r: 1.25 }, ...front]
}

function sectionRect(bed: number, i: number) {
  const col = i % SEC_ACROSS
  const row = Math.floor(i / SEC_ACROSS)
  const w = (BED_W - 0.16) / SEC_ACROSS
  const len = (BED_D1 - BED_D0) / SEC_ALONG
  const x0 = BED_X[bed] - BED_W / 2 + 0.08 + col * w
  const d0 = BED_D0 + row * len
  return { x0, w, d0, len }
}

function seeded(seed: number) {
  let a = (seed * 2654435761) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ===================== Texturen =====================

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function concreteTexture() {
  return canvasTexture(512, (ctx, n) => {
    ctx.fillStyle = '#b3ada2'
    ctx.fillRect(0, 0, n, n)
    const r = seeded(3)
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 70
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},${0.08 + r() * 0.12})`
      ctx.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3)
    }
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(120,112,100,${0.04 + r() * 0.05})`
      ctx.beginPath()
      ctx.ellipse(r() * n, r() * n, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(90,85,78,0.35)'
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, n, n)
  })
}

function raftTexture() {
  return canvasTexture(256, (ctx, n) => {
    ctx.fillStyle = '#e2e3dd'
    ctx.fillRect(0, 0, n, n)
    const r = seeded(9)
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(200,200,190,${r() * 0.25})`
      ctx.fillRect(r() * n, r() * n, 2, 2)
    }
    ctx.fillStyle = '#7c8580'
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 4; x++) {
        ctx.beginPath()
        ctx.arc(((x + 0.5) * n) / 4, ((y + 0.5) * n) / 8, 7, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.strokeStyle = 'rgba(150,150,140,0.6)'
    ctx.strokeRect(1, 1, n - 2, n - 2)
  })
}

function waterNormalTexture() {
  // Normalen aus überlagerten Wellen
  const c = document.createElement('canvas')
  const n = 256
  c.width = c.height = n
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(n, n)
  const waves = Array.from({ length: 7 }, (_, i) => ({ kx: Math.round(Math.cos(i * 1.7) * (2 + i)), ky: Math.round(Math.sin(i * 1.7) * (2 + i)), a: 0.5 / (1 + i * 0.4), p: i }))
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let dx = 0
      let dy = 0
      for (const w of waves) {
        const ph = ((w.kx * x + w.ky * y) / n) * Math.PI * 2 + w.p
        dx += w.a * w.kx * Math.cos(ph) * 0.08
        dy += w.a * w.ky * Math.cos(ph) * 0.08
      }
      const len = Math.hypot(dx, dy, 1)
      const o = (y * n + x) * 4
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[o + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function dotSprite() {
  return canvasTexture(64, (ctx, n) => {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, n, n)
  })
}

// ===================== Geometrien =====================

function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number) {
  const pos = geo.attributes.position
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const v = fn(pos.getX(i), pos.getY(i), pos.getZ(i))
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

/** Ein Blatt entlang +y, Breite in x, gewölbt in z */
function leafGeo(len: number, wid: number, cup: number, curl: number, frill: number, seed: number) {
  const g = new THREE.PlaneGeometry(1, 1, 2, 4)
  const pos = g.attributes.position
  const r = seeded(seed)
  const shade = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) // -0.5..0.5
    const t = pos.getY(i) + 0.5 // 0..1
    const width = Math.sin(Math.PI * Math.pow(t, 0.75)) * wid
    const x = u * width
    const y = t * len
    let z = cup * (u * 2) ** 2 * width + curl * t * t * len
    if (Math.abs(u) > 0.4) z += Math.sin(t * 40 + seed) * frill * (0.5 + r() * 0.5)
    pos.setXYZ(i, x, y, z)
    const v = 0.62 + 0.38 * (1 - Math.abs(u) * 1.2) * (0.5 + 0.5 * t)
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = v
  }
  g.setAttribute('color', new THREE.BufferAttribute(shade, 3))
  g.computeVertexNormals()
  return g
}

function placeLeaf(g: THREE.BufferGeometry, tilt: number, azimuth: number, lift = 0) {
  const m = new THREE.Matrix4()
    .makeRotationY(azimuth)
    .multiply(new THREE.Matrix4().makeRotationX(tilt))
  g.applyMatrix4(m)
  g.translate(0, lift, 0)
  return g
}

function lettuceGeo() {
  const parts: THREE.BufferGeometry[] = []
  const rings = [
    { n: 8, len: 0.55, wid: 0.5, tilt: 1.25, cup: 0.25 },
    { n: 7, len: 0.45, wid: 0.42, tilt: 0.85, cup: 0.3 },
    { n: 5, len: 0.32, wid: 0.32, tilt: 0.45, cup: 0.35 },
  ]
  let s = 1
  rings.forEach((ring, ri) => {
    for (let k = 0; k < ring.n; k++) parts.push(placeLeaf(leafGeo(ring.len, ring.wid, ring.cup, -0.25, 0.025, s++), ring.tilt, (k / ring.n) * Math.PI * 2 + ri * 0.4, 0.02))
  })
  const g = mergeGeometries(parts)!
  return g
}

function herbGeo(stems: number, pairs: number, leafLen: number, leafWid: number) {
  const parts: THREE.BufferGeometry[] = []
  let s = 50
  for (let st = 0; st < stems; st++) {
    const az = (st / stems) * Math.PI * 2
    const lean = stems > 1 ? 0.25 : 0
    const stem = new THREE.CylinderGeometry(0.012, 0.018, 1, 5)
    stem.translate(0, 0.5, 0)
    stem.applyMatrix4(new THREE.Matrix4().makeRotationY(az).multiply(new THREE.Matrix4().makeRotationX(lean)))
    paint(stem, () => 0.55)
    parts.push(stem.toNonIndexed())
    for (let p = 0; p < pairs; p++) {
      const h = 0.25 + (0.75 * p) / pairs
      const size = 1 - p / (pairs * 1.6)
      for (const side of [0, Math.PI]) {
        const leaf = placeLeaf(leafGeo(leafLen * size, leafWid * size, 0.25, -0.2, 0, s++), 1.1, az + side + p * 1.57)
        leaf.translate(Math.sin(az) * Math.sin(lean) * h, h * Math.cos(lean), Math.cos(az) * Math.sin(lean) * h)
        parts.push(leaf.toNonIndexed())
      }
    }
    const top = placeLeaf(leafGeo(leafLen * 0.6, leafWid * 0.6, 0.3, 0, 0, s++), 0.2, az)
    top.translate(Math.sin(az) * Math.sin(lean), Math.cos(lean), Math.cos(az) * Math.sin(lean))
    parts.push(top.toNonIndexed())
  }
  return mergeGeometries(parts)!
}

function chardGeo() {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 7; k++) {
    const leaf = placeLeaf(leafGeo(0.75, 0.38, 0.2, -0.15, 0.02, 80 + k), 0.35 + (k % 3) * 0.15, (k / 7) * Math.PI * 2)
    leaf.translate(0, 0.22, 0)
    parts.push(leaf)
  }
  return mergeGeometries(parts)!
}

function chardStemGeo() {
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 7; k++) {
    const st = new THREE.CylinderGeometry(0.018, 0.026, 0.4, 5)
    st.translate(0, 0.2, 0)
    st.applyMatrix4(new THREE.Matrix4().makeRotationY((k / 7) * Math.PI * 2).multiply(new THREE.Matrix4().makeRotationX(0.35 + (k % 3) * 0.15)))
    parts.push(st)
  }
  return mergeGeometries(parts)!
}

function tomatoGeo() {
  const parts: THREE.BufferGeometry[] = []
  const stem = new THREE.CylinderGeometry(0.012, 0.02, 1, 6)
  stem.translate(0, 0.5, 0)
  paint(stem, () => 0.6)
  parts.push(stem.toNonIndexed())
  let s = 200
  for (let k = 0; k < 9; k++) {
    const h = 0.12 + (k / 9) * 0.85
    const az = k * 2.4
    for (let j = 0; j < 3; j++) {
      const leaf = placeLeaf(leafGeo(0.18, 0.1, 0.2, -0.3, 0.01, s++), 1.2 + j * 0.15, az + (j - 1) * 0.5)
      leaf.translate(Math.sin(az) * 0.06 * j, h, Math.cos(az) * 0.06 * j)
      parts.push(leaf.toNonIndexed())
    }
  }
  return mergeGeometries(parts)!
}

function fishGeo() {
  const body = new THREE.SphereGeometry(0.5, 18, 12)
  body.scale(1, 0.26, 0.2)
  const tail = new THREE.ConeGeometry(0.16, 0.26, 4)
  tail.rotateZ(Math.PI / 2)
  tail.scale(1, 1, 0.25)
  tail.translate(-0.58, 0, 0)
  const fin = new THREE.ConeGeometry(0.07, 0.16, 3)
  fin.scale(1.6, 1, 0.2)
  fin.translate(0.02, 0.15, 0)
  const parts = [body, tail, fin].map((g) => paint(g.toNonIndexed(), (_x, y) => clamp(0.95 - (y + 0.1) * 2.2, 0.35, 1)))
  return mergeGeometries(parts)!
}

// ===================== Fische (Darstellung) =====================

interface Sprite {
  group: number
  tank: number
  u: number
  v: number
  d: number
  heading: number
  turn: number
  dTarget: number
  phase: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ===================== Ansicht =====================

export interface ViewCallbacks {
  onSlot: (slot: number) => void
  onTank: () => void
}

export class GreenhouseView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120)
  private sun = new THREE.DirectionalLight('#fff3df', 2.4)
  private hemi = new THREE.HemisphereLight('#e6f2ff', '#8a8272', 0.9)
  private steel = new THREE.MeshStandardMaterial({ color: '#c9d1d6', metalness: 1, roughness: 0.28 })
  private bedGroups: THREE.Group[] = []
  private rafts: THREE.Mesh[] = []
  private plantMeshes = new Map<string, THREE.InstancedMesh>()
  private plantKey = ''
  private tankGroup = new THREE.Group()
  private tankLevel = -1
  private tankParts: {
    def: TankDef
    water: THREE.Mesh
    surface: THREE.Mesh
    stream: THREE.Mesh
    bubbles: THREE.Points
    pick: THREE.Mesh
  }[] = []
  private fishMesh: THREE.InstancedMesh
  private deadMesh: THREE.InstancedMesh
  private pellets: THREE.InstancedMesh
  private sprites: Sprite[] = []
  private selection: THREE.LineSegments
  private waterNormals = waterNormalTexture()
  private dot = dotSprite()
  private raycaster = new THREE.Raycaster()
  private lastTime = 0
  private dayColor = new THREE.Color('#cfe2ee')
  private nightColor = new THREE.Color('#0b1424')
  // Kamera
  private camD = -2.2
  private camDTarget = -2.2
  private yaw = 0
  private yawTarget = 0
  private disposeInput: () => void

  private canvas: HTMLCanvasElement
  private cb: ViewCallbacks

  constructor(canvas: HTMLCanvasElement, cb: ViewCallbacks) {
    this.canvas = canvas
    this.cb = cb
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer = r

    const pmrem = new THREE.PMREMGenerator(r)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    this.scene.background = this.dayColor.clone()
    this.scene.fog = new THREE.Fog(this.dayColor.clone(), 35, 95)

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera
    sc.left = -12
    sc.right = 12
    sc.top = 26
    sc.bottom = -26
    sc.near = 1
    sc.far = 80
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.sun.target.position.set(0, 0, -17)
    this.scene.add(this.sun, this.sun.target, this.hemi)

    this.buildTunnel()
    this.buildPlumbing()
    this.scene.add(this.tankGroup)

    const fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 })
    this.fishMesh = new THREE.InstancedMesh(fishGeo(), fishMat, 240)
    this.fishMesh.count = 0
    this.fishMesh.frustumCulled = false
    this.fishMesh.castShadow = true
    this.scene.add(this.fishMesh)
    this.deadMesh = new THREE.InstancedMesh(fishGeo(), new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: 0.8 }), 12)
    this.deadMesh.count = 0
    this.deadMesh.frustumCulled = false
    this.scene.add(this.deadMesh)
    this.pellets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 5, 4), new THREE.MeshStandardMaterial({ color: '#6b3f17', roughness: 0.9 }), 80)
    this.pellets.count = 0
    this.pellets.frustumCulled = false
    this.scene.add(this.pellets)

    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.06, 1)),
      new THREE.LineBasicMaterial({ color: '#ffd23a', linewidth: 2 }),
    )
    this.selection.visible = false
    this.scene.add(this.selection)

    this.disposeInput = this.bindInput()
  }

  // ---------- Aufbau ----------

  private buildTunnel() {
    const floorTex = concreteTexture()
    floorTex.repeat.set(4, 12)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(TUNNEL_HALF * 2, TUNNEL_END - TUNNEL_START),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, 0, -(TUNNEL_START + TUNNEL_END) / 2)
    floor.receiveShadow = true
    this.scene.add(floor)

    // Draußen: Wiese
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#7f9a5c', roughness: 1 }))
    outside.rotation.x = -Math.PI / 2
    outside.position.set(0, -0.02, -20)
    this.scene.add(outside)

    const profile = (t: number) => {
      // t: 0 links unten … 1 rechts unten
      if (t < 0.12) return new THREE.Vector2(-TUNNEL_HALF, (t / 0.12) * TUNNEL_WALL)
      if (t > 0.88) return new THREE.Vector2(TUNNEL_HALF, ((1 - t) / 0.12) * TUNNEL_WALL)
      const a = Math.PI * ((t - 0.12) / 0.76)
      return new THREE.Vector2(-Math.cos(a) * TUNNEL_HALF, TUNNEL_WALL + Math.sin(a) * (TUNNEL_APEX - TUNNEL_WALL))
    }
    const N = 48
    // Folie
    const pos: number[] = []
    const idx: number[] = []
    const zs = [TUNNEL_START, TUNNEL_END]
    for (const d of zs)
      for (let k = 0; k <= N; k++) {
        const p = profile(k / N)
        pos.push(p.x, p.y, -d)
      }
    for (let k = 0; k < N; k++) idx.push(k, k + 1, N + 1 + k, k + 1, N + 2 + k, N + 1 + k)
    const cover = new THREE.BufferGeometry()
    cover.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    cover.setIndex(idx)
    cover.computeVertexNormals()
    const film = new THREE.Mesh(
      cover,
      new THREE.MeshStandardMaterial({ color: '#f4f8fa', transparent: true, opacity: 0.32, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    )
    film.renderOrder = 2
    this.scene.add(film)
    // Giebel hinten
    const shape = new THREE.Shape()
    for (let k = 0; k <= N; k++) {
      const p = profile(k / N)
      if (k === 0) shape.moveTo(p.x, p.y)
      else shape.lineTo(p.x, p.y)
    }
    const gable = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: '#f7fbfc', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    )
    gable.position.z = -TUNNEL_END
    this.scene.add(gable)
    // Bögen
    const ribs: THREE.BufferGeometry[] = []
    for (let d = TUNNEL_START + 1; d <= TUNNEL_END; d += 2.5) {
      const pts = Array.from({ length: 40 }, (_, k) => {
        const p = profile(k / 39)
        return new THREE.Vector3(p.x, p.y, -d)
      })
      ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.035, 6, false))
    }
    // Längsstreben
    for (const t of [0.12, 0.25, 0.375, 0.5, 0.625, 0.75, 0.88, 0.06, 0.94]) {
      const p = profile(t)
      const g = new THREE.CylinderGeometry(0.022, 0.022, TUNNEL_END - TUNNEL_START, 6)
      g.rotateX(Math.PI / 2)
      g.translate(p.x, p.y, -(TUNNEL_START + TUNNEL_END) / 2)
      ribs.push(g)
    }
    const frame = new THREE.Mesh(mergeGeometries(ribs.map((g) => g.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: '#b9c2c8', metalness: 0.9, roughness: 0.4 }))
    frame.castShadow = true
    this.scene.add(frame)
    // Lampen unter dem First
    const lampGeo = new THREE.BoxGeometry(0.5, 0.08, 0.18)
    const lampMat = new THREE.MeshStandardMaterial({ color: '#5d676d', roughness: 0.5 })
    for (let d = 4; d < TUNNEL_END; d += 6) {
      const l = new THREE.Mesh(lampGeo, lampMat)
      l.position.set(0, TUNNEL_APEX - 0.6, -d)
      this.scene.add(l)
    }
  }

  private pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, parent: THREE.Object3D = this.scene) {
    const len = a.distanceTo(b)
    const g = new THREE.CylinderGeometry(r, r, len, 16)
    const m = new THREE.Mesh(g, this.steel)
    m.position.copy(a).add(b).multiplyScalar(0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    m.castShadow = true
    parent.add(m)
    return m
  }

  private buildPlumbing() {
    // Biofilter
    for (const x of [-0.45, 0.45]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 32), this.steel)
      f.position.set(x, 0.8, -5)
      f.castShadow = true
      this.scene.add(f)
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 32), this.steel)
      lid.position.set(x, 1.62, -5)
      this.scene.add(lid)
    }
    // Hauptleitung am Boden zu den Beeten
    this.pipe(new THREE.Vector3(0, 0.12, -5), new THREE.Vector3(0, 0.12, -(BED_D0 - 0.3)), 0.08)
    this.pipe(new THREE.Vector3(-5, 0.12, -(BED_D0 - 0.3)), new THREE.Vector3(5, 0.12, -(BED_D0 - 0.3)), 0.06)
    // Steigleitung mit Pumpe
    this.pipe(new THREE.Vector3(0, 0.1, -4.6), new THREE.Vector3(0, 1.4, -4.6), 0.07)
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.32), new THREE.MeshStandardMaterial({ color: '#2a3238', roughness: 0.5 }))
    pump.position.set(0, 0.2, -4.2)
    pump.castShadow = true
    this.scene.add(pump)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.34), new THREE.MeshStandardMaterial({ color: '#2a6fd6', roughness: 0.4 }))
    cap.position.set(0, 0.38, -4.2)
    this.scene.add(cap)
  }

  private buildBeds(n: number) {
    for (const g of this.bedGroups) this.scene.remove(g)
    this.bedGroups = []
    this.rafts = []
    const raftTex = raftTexture()
    const raftMat = new THREE.MeshStandardMaterial({ map: raftTex, roughness: 0.85 })
    const troughMat = new THREE.MeshStandardMaterial({ color: '#dfe3e4', roughness: 0.6 })
    const waterMat = new THREE.MeshStandardMaterial({ color: '#2f4a4d', roughness: 0.1, metalness: 0.1 })
    const legMat = new THREE.MeshStandardMaterial({ color: '#9aa3a8', metalness: 0.8, roughness: 0.4 })
    const len = BED_D1 - BED_D0
    for (let b = 0; b < n; b++) {
      const g = new THREE.Group()
      const cx = BED_X[b]
      const cz = -(BED_D0 + BED_D1) / 2
      // Wanne
      const trough = new THREE.Mesh(new THREE.BoxGeometry(BED_W, 0.28, len), troughMat)
      trough.position.set(cx, BED_H - 0.14, cz)
      trough.castShadow = trough.receiveShadow = true
      g.add(trough)
      const water = new THREE.Mesh(new THREE.PlaneGeometry(BED_W - 0.1, len - 0.1), waterMat)
      water.rotation.x = -Math.PI / 2
      water.position.set(cx, BED_H + 0.002, cz)
      g.add(water)
      // Tischbeine und Querträger
      for (let d = BED_D0 + 0.3; d <= BED_D1; d += 2.4)
        for (const x of [cx - BED_W / 2 + 0.12, cx + BED_W / 2 - 0.12]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, BED_H - 0.28, 0.06), legMat)
          leg.position.set(x, (BED_H - 0.28) / 2, -d)
          leg.castShadow = true
          g.add(leg)
        }
      // Platten (= Pflanzplätze)
      for (let i = 0; i < SLOTS_PER_BED; i++) {
        const r = sectionRect(b, i)
        const raft = new THREE.Mesh(new THREE.BoxGeometry(r.w - 0.03, 0.04, r.len - 0.03), raftMat)
        raft.position.set(r.x0 + r.w / 2, BED_H + 0.02, -(r.d0 + r.len / 2))
        raft.receiveShadow = true
        raft.userData.slot = b * SLOTS_PER_BED + i
        g.add(raft)
        this.rafts.push(raft)
      }
      // Zulaufrohr vorne
      this.pipe(new THREE.Vector3(cx - BED_W / 2, BED_H - 0.32, -(BED_D0 - 0.12)), new THREE.Vector3(cx + BED_W / 2, BED_H - 0.32, -(BED_D0 - 0.12)), 0.045, g)
      this.pipe(new THREE.Vector3(cx, 0.12, -(BED_D0 - 0.3)), new THREE.Vector3(cx, BED_H - 0.32, -(BED_D0 - 0.12)), 0.04, g)
      this.scene.add(g)
      this.bedGroups.push(g)
    }
  }

  private buildTanks(level: number) {
    this.tankGroup.clear()
    this.tankParts = []
    const band = new THREE.MeshStandardMaterial({ color: '#1f80c6', roughness: 0.35, side: THREE.DoubleSide })
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#cfeeff',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const defs = tankLayout(level)
    for (const def of defs) {
      const { x, d, r } = def
      const z = -d
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(r, r, TANK_H - 0.25, 64, 1, true), glass)
      lower.position.set(x, (TANK_H - 0.25) / 2, z)
      lower.renderOrder = 3
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.25, 64, 1, true), band)
      upper.position.set(x, TANK_H - 0.125, z)
      upper.castShadow = true
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 64), band)
      rim.rotation.x = Math.PI / 2
      rim.position.set(x, TANK_H, z)
      const foot = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 8, 64), band)
      foot.rotation.x = Math.PI / 2
      foot.position.set(x, 0.03, z)
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ color: '#1b5d85', roughness: 0.6 }))
      bottom.rotation.x = -Math.PI / 2
      bottom.position.set(x, 0.01, z)
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(r - 0.02, r - 0.02, TANK_H - 0.1, 48, 1, true),
        new THREE.MeshPhysicalMaterial({ color: '#1c7ea6', roughness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      )
      water.position.set(x, (TANK_H - 0.1) / 2, z)
      water.renderOrder = 1
      const normals = this.waterNormals.clone()
      normals.repeat.set(2, 2)
      const surface = new THREE.Mesh(
        new THREE.CircleGeometry(r - 0.02, 64),
        new THREE.MeshPhysicalMaterial({
          color: '#2a8db0',
          roughness: 0.06,
          metalness: 0,
          transparent: true,
          opacity: 0.32,
          normalMap: normals,
          normalScale: new THREE.Vector2(0.6, 0.6),
          envMapIntensity: 1.1,
          depthWrite: false,
        }),
      )
      surface.rotation.x = -Math.PI / 2
      surface.position.set(x, TANK_H - 0.1, z)
      surface.renderOrder = 2
      // Zulauf
      const inX = x + (x < 0 ? 0.5 : -0.5) * r
      const inZ = z - r * 0.55
      this.pipe(new THREE.Vector3(inX, TANK_H + 0.45, -4.6), new THREE.Vector3(inX, TANK_H + 0.45, inZ), 0.05, this.tankGroup)
      this.pipe(new THREE.Vector3(inX, TANK_H + 0.45, inZ), new THREE.Vector3(inX, TANK_H + 0.2, inZ), 0.05, this.tankGroup)
      const stream = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.05, 0.3, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, roughness: 0.1, depthWrite: false }),
      )
      stream.position.set(inX, TANK_H + 0.03, inZ)
      // Luftblasen und Schaum
      const nb = 160
      const bpos = new Float32Array(nb * 3)
      const bubbles = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(bpos, 3)),
        new THREE.PointsMaterial({ map: this.dot, size: 0.05, transparent: true, depthWrite: false, opacity: 0.85 }),
      )
      bubbles.frustumCulled = false
      bubbles.userData.seed = Array.from({ length: nb }, () => [Math.random(), Math.random(), Math.random()])
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(r, r, TANK_H, 16), new THREE.MeshBasicMaterial({ visible: false }))
      pick.position.set(x, TANK_H / 2, z)
      pick.userData.tank = true
      this.tankGroup.add(bottom, water, surface, lower, upper, rim, foot, stream, bubbles, pick)
      this.tankParts.push({ def, water, surface, stream, bubbles, pick })
    }
    // Querleitung über den Becken
    const xs = defs.map((d) => d.x + (d.x < 0 ? 0.5 : -0.5) * d.r)
    this.pipe(new THREE.Vector3(Math.min(...xs, 0) - 0.05, TANK_H + 0.45, -4.6), new THREE.Vector3(Math.max(...xs, 0) + 0.05, TANK_H + 0.45, -4.6), 0.065, this.tankGroup)
  }

  // ---------- Pflanzen ----------

  private plantMesh(key: string, make: () => THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    let m = this.plantMeshes.get(key)
    if (!m) {
      m = new THREE.InstancedMesh(make(), mat, cap)
      m.receiveShadow = true
      m.frustumCulled = false
      m.userData.slots = new Int32Array(cap)
      this.plantMeshes.set(key, m)
      this.scene.add(m)
    }
    return m
  }

  private updatePlants(s: GameState) {
    const cap = MAX_BEDS * SLOTS_PER_BED * 24
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide })
    const meshes: Record<string, THREE.InstancedMesh> = {
      salat: this.plantMesh('salat', lettuceGeo, leafMat, cap),
      basilikum: this.plantMesh('basilikum', () => herbGeo(1, 4, 0.36, 0.26), leafMat, cap),
      minze: this.plantMesh('minze', () => herbGeo(4, 4, 0.26, 0.18), leafMat, cap),
      mangold: this.plantMesh('mangold', chardGeo, leafMat, cap),
      mangoldStem: this.plantMesh('mangoldStem', chardStemGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), cap),
      tomate: this.plantMesh('tomate', tomatoGeo, leafMat, cap),
      tomatoFruit: this.plantMesh('tomatoFruit', () => new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.3 }), cap),
    }
    const counts: Record<string, number> = {}
    for (const k of Object.keys(meshes)) counts[k] = 0
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    const wilt = clamp((s.dryHours - 3) / 24)
    const add = (key: string, slot: number, x: number, y: number, z: number, sx: number, sy: number, rotY: number, c: THREE.Color, tiltX = 0) => {
      const mesh = meshes[key]
      const i = counts[key]++
      q.setFromEuler(new THREE.Euler(tiltX, rotY, 0))
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sx))
      mesh.setMatrixAt(i, m4)
      mesh.setColorAt(i, c)
      ;(mesh.userData.slots as Int32Array)[i] = slot
    }
    for (let slot = 0; slot < s.slots.length; slot++) {
      const p = s.slots[slot]
      if (!p) continue
      const bed = Math.floor(slot / SLOTS_PER_BED)
      const sec = sectionRect(bed, slot % SLOTS_PER_BED)
      const sp = PLANTS[p.species]
      const g = clamp(p.mass / plantMaxMass(sp), 0.03, 1)
      const tall = !!sp.fruiting
      const across = tall ? 2 : 3
      const along = tall ? 4 : 6
      const rnd = seeded(p.id * 13 + slot)
      plantColor(p, col)
      const droop = wilt + (p.dead ? 0.6 : 0)
      for (let a = 0; a < across; a++)
        for (let b = 0; b < along; b++) {
          const x = sec.x0 + ((a + 0.5) * sec.w) / across + (rnd() - 0.5) * 0.04
          const z = -(sec.d0 + ((b + 0.5) * sec.len) / along + (rnd() - 0.5) * 0.05)
          const rot = rnd() * Math.PI * 2
          const vary = 0.85 + rnd() * 0.3
          const c = col.clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.05)
          const y = BED_H + 0.04
          switch (p.species as PlantId) {
            case 'salat': {
              const d = 0.4 * (0.2 + 0.8 * Math.sqrt(g)) * vary
              add('salat', slot, x, y, z, d, d * 0.75 * (1 - droop * 0.6), rot, c)
              break
            }
            case 'basilikum': {
              const h = 0.42 * (0.25 + 0.75 * Math.sqrt(g)) * vary
              add('basilikum', slot, x, y, z, h * 0.9, h * (1 - droop * 0.5), rot, c, droop * 0.6)
              break
            }
            case 'minze': {
              const h = 0.32 * (0.25 + 0.75 * Math.sqrt(g)) * vary
              add('minze', slot, x, y, z, h * 1.1, h * (1 - droop * 0.5), rot, c, droop * 0.6)
              break
            }
            case 'mangold': {
              const h = 0.5 * (0.25 + 0.75 * Math.sqrt(g)) * vary
              add('mangold', slot, x, y, z, h * 0.8, h * (1 - droop * 0.5), rot, c)
              const stem = new THREE.Color(p.dead ? '#6b4a2f' : ['#c8372d', '#e2b12b', '#efe8d6'][Math.floor(rnd() * 3)])
              add('mangoldStem', slot, x, y, z, h * 0.8, h * (1 - droop * 0.5), rot, stem)
              break
            }
            case 'tomate': {
              const h = (0.25 + 1.5 * Math.sqrt(g)) * vary
              add('tomate', slot, x, y, z, h * 0.8, h, rot, c, droop * 0.5)
              const fruits = Math.min(8, Math.floor(p.fruit / 120))
              for (let f = 0; f < fruits; f++) {
                const fh = h * (0.25 + rnd() * 0.5)
                const fa = rnd() * Math.PI * 2
                const fc = new THREE.Color(f < fruits * 0.6 ? '#c9261e' : '#7fb43c')
                add('tomatoFruit', slot, x + Math.cos(fa) * 0.1, y + fh, z + Math.sin(fa) * 0.1, 1, 1, 0, fc)
              }
              break
            }
          }
        }
    }
    for (const [k, mesh] of Object.entries(meshes)) {
      mesh.count = counts[k]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }

  // ---------- Fische ----------

  private syncSprites(s: GameState, nTanks: number) {
    const total = s.fish.reduce((a, g) => a + g.count, 0)
    const cap = 55 * nTanks
    const scale = total > cap ? cap / total : 1
    const want = new Map<number, number>()
    for (const g of s.fish) want.set(g.id, Math.max(1, Math.round(g.count * scale)))
    const have = new Map<number, number>()
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sp = this.sprites[i]
      const n = have.get(sp.group) ?? 0
      if (n >= (want.get(sp.group) ?? 0) || sp.tank >= nTanks) {
        this.sprites.splice(i, 1)
        continue
      }
      have.set(sp.group, n + 1)
    }
    let k = this.sprites.length
    for (const g of s.fish)
      for (let i = have.get(g.id) ?? 0; i < (want.get(g.id) ?? 0); i++) {
        const a = rand(0, Math.PI * 2)
        const r = Math.sqrt(rand(0, 0.8))
        this.sprites.push({ group: g.id, tank: k++ % nTanks, u: Math.cos(a) * r, v: Math.sin(a) * r, d: rand(0.1, 0.9), heading: a + Math.PI / 2, turn: 0, dTarget: rand(0.1, 0.9), phase: rand(0, 6) })
      }
  }

  private updateFish(s: GameState, time: number, dt: number, running: boolean) {
    const w = s.water
    this.syncSprites(s, this.tankParts.length)
    const byId = new Map(s.fish.map((g) => [g.id, g]))
    const gasp = w.o2 < 2.5
    const feeding = w.floatingFeed > 0.2
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const col = new THREE.Color()
    let n = 0
    for (const sp of this.sprites) {
      const g = byId.get(sp.group)
      const t = this.tankParts[sp.tank]
      if (!g || !t) continue
      const { x, d, r } = t.def
      const speed = (g.health < 40 ? 0.1 : 0.32) * (running ? 1 : 0.5)
      sp.turn += (rand(-1, 1) * 2 - sp.turn) * dt * 0.8
      const flow = Math.atan2(sp.v, sp.u) + Math.PI / 2
      let target = flow + sp.turn * 0.6
      if (Math.hypot(sp.u, sp.v) > 0.8) target = Math.atan2(-sp.v, -sp.u)
      const diff = Math.atan2(Math.sin(target - sp.heading), Math.cos(target - sp.heading))
      sp.heading += diff * Math.min(1, dt * 2.2)
      sp.u += Math.cos(sp.heading) * speed * dt
      sp.v += Math.sin(sp.heading) * speed * dt
      const rr = Math.hypot(sp.u, sp.v)
      if (rr > 0.88) {
        sp.u *= 0.88 / rr
        sp.v *= 0.88 / rr
      }
      if (Math.random() < dt * 0.25) sp.dTarget = g.species === 'wels' || g.species === 'karpfen' ? rand(0.45, 0.95) : rand(0.05, 0.9)
      sp.d += ((gasp || feeding ? 0.02 : sp.dTarget) - sp.d) * Math.min(1, dt * 0.8)
      const len = 0.05 * Math.cbrt(g.weight) * 1.0
      const y = TANK_H - 0.14 - sp.d * (TANK_H - 0.3)
      const wag = Math.sin(time * (g.health < 40 ? 5 : 10) + sp.phase) * 0.15
      e.set(g.health < 40 ? 0.5 : 0, -sp.heading + wag, gasp ? 0.35 : 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x + sp.u * r, y, -d + sp.v * r), q, new THREE.Vector3(len, len, len))
      this.fishMesh.setMatrixAt(n, m4)
      col.set(FISH[g.species].body)
      this.fishMesh.setColorAt(n, col)
      n++
      if (n >= 240) break
    }
    this.fishMesh.count = n
    this.fishMesh.instanceMatrix.needsUpdate = true
    if (this.fishMesh.instanceColor) this.fishMesh.instanceColor.needsUpdate = true

    // Tote Fische und Futter im ersten Becken
    const t0 = this.tankParts[0]
    const dead = Math.min(12, w.deadCount)
    for (let i = 0; i < dead; i++) {
      const a = i * 1.9 + 0.4
      e.set(Math.PI, a, 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(t0.def.x + Math.cos(a) * 0.55 * t0.def.r, TANK_H - 0.1, -t0.def.d + Math.sin(a) * 0.55 * t0.def.r), q, new THREE.Vector3(0.25, 0.25, 0.25))
      this.deadMesh.setMatrixAt(i, m4)
    }
    this.deadMesh.count = dead
    this.deadMesh.instanceMatrix.needsUpdate = true
    const pel = Math.min(80, Math.round(w.floatingFeed * 2))
    for (let i = 0; i < pel; i++) {
      const a = i * 2.39996
      const rr = Math.sqrt(i / 80) * 0.5 * t0.def.r
      m4.makeTranslation(t0.def.x + Math.cos(a) * rr, TANK_H - 0.095, -t0.def.d + Math.sin(a) * rr)
      this.pellets.setMatrixAt(i, m4)
    }
    this.pellets.count = pel
    this.pellets.instanceMatrix.needsUpdate = true
  }

  private updateWater(s: GameState, time: number) {
    const w = s.water
    const turb = clamp(w.solids / 600)
    const algae = clamp((w.no3 - 20) / 200) * 0.5
    const base = new THREE.Color('#2a8db0').lerp(new THREE.Color('#5f9a4e'), algae).lerp(new THREE.Color('#857048'), turb * 0.7)
    const body = new THREE.Color('#1c7ea6').lerp(new THREE.Color('#6a9a50'), algae).lerp(new THREE.Color('#8a7650'), turb * 0.7)
    for (const t of this.tankParts) {
      const sm = t.surface.material as THREE.MeshPhysicalMaterial
      sm.color.copy(base)
      sm.normalMap!.offset.set(time * 0.02, time * 0.013)
      ;(t.water.material as THREE.MeshPhysicalMaterial).color.copy(body)
      t.stream.visible = s.equip.pumpOn
      t.stream.scale.y = 1 + Math.sin(time * 20) * 0.05
      // Luftblasen steigen auf und schäumen oben
      const geo = t.bubbles.geometry
      const pos = geo.attributes.position as THREE.BufferAttribute
      const seeds = t.bubbles.userData.seed as number[][]
      const active = s.equip.airPump * 50 + (s.equip.pumpOn ? 20 : 0)
      const { x, d, r } = t.def
      const inX = x + (x < 0 ? 0.5 : -0.5) * r
      for (let i = 0; i < seeds.length; i++) {
        const [a, b, c] = seeds[i]
        if (i >= active) {
          pos.setXYZ(i, 0, -10, 0)
          continue
        }
        if (i < 20 && s.equip.pumpOn) {
          // Schaum am Zulauf
          const ang = a * Math.PI * 2 + time * 1.5
          const rad = ((b + time * 0.4) % 1) * 0.35
          pos.setXYZ(i, inX + Math.cos(ang) * rad, TANK_H - 0.09, -d - r * 0.55 + Math.sin(ang) * rad)
          continue
        }
        const stone = Math.floor(c * Math.max(1, s.equip.airPump))
        const sx = x + (stone - (s.equip.airPump - 1) / 2) * r * 0.5
        const prog = (b + time * (0.25 + a * 0.2)) % 1
        pos.setXYZ(i, sx + Math.sin(time * 3 + i) * 0.05 + (a - 0.5) * 0.2, 0.08 + prog * (TANK_H - 0.18), -d + (c - 0.5) * 0.25)
      }
      pos.needsUpdate = true
    }
  }

  // ---------- Kamera und Eingabe ----------

  private bindInput() {
    const c = this.canvas
    let down: { x: number; y: number; id: number } | null = null
    let dragging = false
    let last = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId }
      last = { x: e.clientX, y: e.clientY }
      dragging = false
      c.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) dragging = true
      if (dragging) {
        const dx = e.clientX - last.x
        const dy = e.clientY - last.y
        this.yawTarget = clamp(this.yawTarget + dx * 0.005, -1.3, 1.3)
        this.camDTarget = clamp(this.camDTarget - dy * 0.04, -3, 30)
      }
      last = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      if (down && !dragging) this.pick(e.clientX, e.clientY)
      down = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      this.camDTarget = clamp(this.camDTarget + e.deltaY * 0.012, -3, 30)
      this.yawTarget = clamp(this.yawTarget - e.deltaX * 0.003, -1.3, 1.3)
    }
    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerup', onUp)
    c.addEventListener('pointercancel', onUp)
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerup', onUp)
      c.removeEventListener('pointercancel', onUp)
      c.removeEventListener('wheel', onWheel)
    }
  }

  /** Kamera zurück zum Eingang */
  resetCamera() {
    this.camDTarget = -2.2
    this.yawTarget = 0
  }

  private pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = [...this.rafts, ...this.tankParts.map((t) => t.pick), ...this.plantMeshes.values()]
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return
    const o = hit.object
    if (o.userData.tank) this.cb.onTank()
    else if (o.userData.slot !== undefined) this.cb.onSlot(o.userData.slot as number)
    else if (hit.instanceId !== undefined && o.userData.slots) this.cb.onSlot((o.userData.slots as Int32Array)[hit.instanceId])
  }

  private updateCamera(dt: number) {
    const k = Math.min(1, dt * 6)
    this.camD += (this.camDTarget - this.camD) * k
    this.yaw += (this.yawTarget - this.yaw) * k
    const walk = clamp((this.camD - 0) / 9)
    const height = 3.1 - walk * 1.0
    const pitch = -0.38 + walk * 0.16
    this.camera.position.set(0, height, -this.camD)
    const dir = new THREE.Vector3(Math.sin(-this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch))
    this.camera.lookAt(this.camera.position.clone().add(dir))
  }

  private updateLight(s: GameState) {
    const light = currentLight(s)
    const hour = s.t % 24
    const az = ((hour - 6) / 12) * Math.PI
    this.sun.position.set(Math.cos(az) * 14, 6 + light * 16, -17 + Math.sin(az) * 6)
    this.sun.intensity = 3.2 * light
    this.hemi.intensity = 0.12 + 0.5 * light
    this.scene.environmentIntensity = 0.12 + 0.3 * light
    const bg = this.nightColor.clone().lerp(this.dayColor, clamp(light * 2))
    ;(this.scene.background as THREE.Color).copy(bg)
    this.scene.fog!.color.copy(bg)
  }

  // ---------- Bild ----------

  render(s: GameState, time: number, selected: number, running: boolean) {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime))
    this.lastTime = time
    const c = this.canvas
    const w = c.clientWidth
    const h = c.clientHeight
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false)
      this.camera.aspect = w / h
      this.camera.fov = w / h < 1.1 ? 62 : 55
      this.camera.updateProjectionMatrix()
    }
    if (this.bedGroups.length !== s.equip.beds) {
      this.buildBeds(s.equip.beds)
      this.plantKey = ''
    }
    if (this.tankLevel !== s.equip.tankLevel) {
      this.tankLevel = s.equip.tankLevel
      this.buildTanks(this.tankLevel)
    }
    const key = plantKey(s)
    if (key !== this.plantKey) {
      this.plantKey = key
      this.updatePlants(s)
    }
    if (selected >= 0 && selected < s.equip.beds * SLOTS_PER_BED) {
      const r = sectionRect(Math.floor(selected / SLOTS_PER_BED), selected % SLOTS_PER_BED)
      this.selection.visible = true
      this.selection.position.set(r.x0 + r.w / 2, BED_H + 0.04, -(r.d0 + r.len / 2))
      this.selection.scale.set(r.w - 0.02, 1, r.len - 0.02)
    } else this.selection.visible = false

    this.updateCamera(dt)
    this.updateLight(s)
    this.updateWater(s, time)
    this.updateFish(s, time, dt, running)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposeInput()
    this.renderer.dispose()
  }
}

function plantColor(p: Plant, out: THREE.Color) {
  if (p.dead) return out.setHSL(32 / 360, 0.35, 0.3)
  const base: Record<PlantId, [number, number, number]> = {
    salat: [96, 72, 42],
    basilikum: [112, 65, 30],
    minze: [126, 52, 34],
    mangold: [118, 58, 26],
    tomate: [110, 52, 30],
  }
  const [h, sat, l] = base[p.species]
  return out.setHSL(
    (h - p.chlorosis * 48 - (1 - p.health / 100) * 45) / 360,
    (sat - p.nDeficit * 28) / 100,
    (l + p.chlorosis * 16 + p.nDeficit * 12) / 100,
  )
}

function plantKey(s: GameState) {
  let k = `${s.equip.beds}|${Math.round(s.dryHours / 3)}`
  for (const p of s.slots)
    k += p ? `|${p.id}:${Math.round(Math.sqrt(p.mass) * 3)}:${Math.round(p.health / 10)}:${Math.round(p.chlorosis * 6)}:${Math.round(p.nDeficit * 5)}:${Math.floor(p.fruit / 120)}:${p.dead ? 1 : 0}` : '|-'
  return k
}

