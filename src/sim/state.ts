import { FISH, PLANTS, SLOTS_PER_BED, TANK_SIZES, TAP, type FishId, type PlantId } from './data.ts'

export interface FishGroup {
  id: number
  species: FishId
  count: number
  /** Durchschnittsgewicht (g) */
  weight: number
  /** 0–100 */
  health: number
  /** Futter im Magen (g, ganze Gruppe) */
  stomach: number
  hoursHungry: number
  /** Bruchteil eines Todesfalls, sammelt sich an */
  deathAcc: number
  /** 0–1, Befall mit Weißpünktchenkrankheit */
  disease: number
}

export interface Plant {
  id: number
  species: PlantId
  ageH: number
  /** Frischmasse (g) */
  mass: number
  /** Früchte (g), nur Tomate */
  fruit: number
  health: number
  /** 0–1, gelbe Blätter durch Eisenmangel */
  chlorosis: number
  /** 0–1, blasse Blätter durch Stickstoffmangel */
  nDeficit: number
  dead: boolean
}

export interface Water {
  volume: number
  temp: number
  /** Gesamt-Ammonium/Ammoniak als Stickstoff (mg/L) */
  tan: number
  /** Nitrit-N (mg/L) */
  no2: number
  /** Nitrat-N (mg/L) */
  no3: number
  /** Karbonathärte (°dKH) */
  kh: number
  /** Kohlendioxid (mg/L) */
  co2: number
  /** Sauerstoff (mg/L) */
  o2: number
  /** Eisen (mg/L) */
  fe: number
  /** Schlamm / Futterreste (g) */
  solids: number
  /** Schwimmendes Futter (g) */
  floatingFeed: number
  /** Tote Fische (g) */
  deadMass: number
  deadCount: number
  /** Salz (g/L) */
  salt: number
  /** Schlamm im Radialabscheider (g) */
  sludge: number
  /** Schlamm im Mineralisierungstank (g) */
  mineral: number
}

export interface Reading {
  t: number
  temp: number
  tan: number
  nh3: number
  no2: number
  no3: number
  ph: number
  kh: number
  o2: number
  fe: number
}

export type LogKind = 'info' | 'good' | 'warn' | 'bad'
export interface LogEntry {
  t: number
  kind: LogKind
  text: string
}

export interface Equipment {
  tankLevel: number
  beds: number
  airPump: number
  heater: boolean
  heaterOn: boolean
  heaterSet: number
  pumpOn: boolean
  autoFeeder: boolean
  autoFeederOn: boolean
  /** Prozent der Fischmasse pro Tag */
  autoFeedRate: number
  probes: boolean
  /** 0 = keiner, 1 = Radialabscheider, 2 = Trommelfilter */
  mechFilter: number
  /** Anzahl MBBR-Biofilter-Module */
  mbbr: number
  degasser: boolean
  uv: boolean
  oxygen: boolean
  oxygenOn: boolean
  generator: boolean
  /** Akku-Luftpumpe für Stromausfälle */
  batteryAir: boolean
  mineralizer: boolean
  doser: boolean
  doserOn: boolean
  doserKh: number
  doserFe: number
  airHeater: boolean
  airHeaterOn: boolean
  airHeaterSet: number
  climate: boolean
  led: boolean
  ledOn: boolean
  insectNet: boolean
}

/** Was gerade läuft (wird jeden Schritt neu berechnet) */
export interface Live {
  air: number
  light: number
  plantLight: number
  power: boolean
  airHeating: boolean
  venting: boolean
  shading: boolean
  ledActive: boolean
  watts: number
}

export interface Stats {
  revenue: number
  spent: number
  plantsHarvested: number
  fishSold: number
  fishDied: number
  feedUsed: number
}

export interface GameState {
  version: 2
  /** Spielzeit in Stunden seit Start */
  t: number
  /** Kalendertag (1–365) beim Start */
  startDoy: number
  money: number
  feedStock: number
  tests: number
  water: Water
  aob: number
  nob: number
  fish: FishGroup[]
  /** beds × SLOTS_PER_BED, null = leer */
  slots: (Plant | null)[]
  equip: Equipment
  readings: Reading[]
  log: LogEntry[]
  stats: Stats
  nextId: number
  /** Stunden ohne Pumpe (Beet trocknet aus) */
  dryHours: number
  /** Merker, damit Warnungen nicht ständig wiederholt werden */
  flags: Record<string, number>
  /** Zeitpunkt der letzten Stromabrechnung */
  lastBill: number
  energyKWh: number
  /** Restdauer eines Stromausfalls (h) */
  outage: number
  /** 0–1, Blattlausdruck */
  pests: number
  /** 0–1, Nützlinge im Gewächshaus */
  beneficials: number
  live: Live
}

export function tankVolume(level: number) {
  return TANK_SIZES[level]
}

export function newGame(): GameState {
  const s: GameState = {
    version: 2,
    t: 8,
    startDoy: 100,
    money: 300,
    feedStock: 2000,
    tests: 10,
    water: {
      volume: tankVolume(0),
      temp: 14,
      tan: 0,
      no2: 0,
      no3: TAP.no3,
      kh: TAP.kh,
      co2: TAP.co2,
      o2: 9,
      fe: TAP.fe,
      solids: 0,
      floatingFeed: 0,
      deadMass: 0,
      deadCount: 0,
      salt: 0,
      sludge: 0,
      mineral: 0,
    },
    aob: 0.2,
    nob: 0.15,
    fish: [],
    slots: Array.from({ length: SLOTS_PER_BED }, () => null),
    equip: {
      tankLevel: 0,
      beds: 1,
      airPump: 1,
      heater: false,
      heaterOn: false,
      heaterSet: 25,
      pumpOn: true,
      autoFeeder: false,
      autoFeederOn: false,
      autoFeedRate: 1.5,
      probes: false,
      mechFilter: 0,
      mbbr: 0,
      degasser: false,
      uv: false,
      oxygen: false,
      oxygenOn: true,
      generator: false,
      batteryAir: false,
      mineralizer: false,
      doser: false,
      doserOn: true,
      doserKh: 3,
      doserFe: 1.5,
      airHeater: false,
      airHeaterOn: true,
      airHeaterSet: 12,
      climate: false,
      led: false,
      ledOn: true,
      insectNet: false,
    },
    readings: [],
    log: [],
    stats: { revenue: 0, spent: 0, plantsHarvested: 0, fishSold: 0, fishDied: 0, feedUsed: 0 },
    nextId: 1,
    dryHours: 0,
    flags: {},
    lastBill: 8,
    energyKWh: 0,
    outage: 0,
    pests: 0,
    beneficials: 0,
    live: { air: 14, light: 0, plantLight: 0, power: true, airHeating: false, venting: false, shading: false, ledActive: false, watts: 0 },
  }
  s.log.push({
    t: s.t,
    kind: 'info',
    text:
      'Willkommen! Dein Fischbecken (1000 L) ist mit Leitungswasser gefüllt, das Pflanzbeet ist leer. ' +
      'Eine neue Anlage muss erst „einfahren“: Bakterien, die giftiges Ammoniak in Nitrat umwandeln, brauchen einige Wochen. ' +
      'Setz am Anfang nur wenige Fische ein, füttere sparsam und miss regelmäßig das Wasser.',
  })
  return s
}

export function speciesOfFish(g: FishGroup) {
  return FISH[g.species]
}
export function speciesOfPlant(p: Plant) {
  return PLANTS[p.species]
}

const KEY = 'aquaponik-sim-v1'

export function save(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Speicher voll oder gesperrt: dann eben nicht
  }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as GameState
    if ((s.version as number) === 1) return migrate(s)
    if (s.version !== 2) return null
    return s
  } catch {
    return null
  }
}

/** Ältere Spielstände um neue Felder ergänzen */
function migrate(old: GameState): GameState {
  const fresh = newGame()
  const s: GameState = {
    ...fresh,
    ...old,
    version: 2,
    water: { ...fresh.water, ...old.water },
    equip: { ...fresh.equip, ...old.equip },
    live: fresh.live,
  }
  for (const g of s.fish) g.disease ??= 0
  return s
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // egal
  }
}
