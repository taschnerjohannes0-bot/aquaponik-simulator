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
  version: 1
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
}

export function tankVolume(level: number) {
  return TANK_SIZES[level]
}

export function newGame(): GameState {
  const s: GameState = {
    version: 1,
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
    },
    readings: [],
    log: [],
    stats: { revenue: 0, spent: 0, plantsHarvested: 0, fishSold: 0, fishDied: 0, feedUsed: 0 },
    nextId: 1,
    dryHours: 0,
    flags: {},
    lastBill: 8,
    energyKWh: 0,
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
    if (s.version !== 1) return null
    return s
  } catch {
    return null
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // egal
  }
}
