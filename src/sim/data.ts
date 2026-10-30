// Arten-Daten. Werte sind an reale Aquaponik-Richtwerte angelehnt, für das Spiel leicht vereinfacht.

export type FishId = 'tilapia' | 'karpfen' | 'forelle' | 'wels'
export type PlantId = 'salat' | 'basilikum' | 'minze' | 'mangold' | 'tomate'

export interface FishSpecies {
  id: FishId
  name: string
  /** Wohlfühlbereich Temperatur (°C) */
  optMin: number
  optMax: number
  /** Unter-/Obergrenze, ab der es lebensgefährlich wird */
  tMin: number
  tMax: number
  /** Mindest-Sauerstoff (mg/L), darunter Stress */
  doMin: number
  /** Empfindlichkeit gegen Ammoniak/Nitrit (1 = normal) */
  sensitivity: number
  /** Futterbedarf: Tagesration (g) = appetite · Gewicht^0,75 */
  appetite: number
  fcr: number
  startWeight: number
  maxWeight: number
  harvestWeight: number
  priceFingerling: number
  pricePerKg: number
  /** Farben für die Zeichnung */
  body: string
  belly: string
  fin: string
  info: string
}

export const FISH: Record<FishId, FishSpecies> = {
  tilapia: {
    id: 'tilapia',
    name: 'Tilapia',
    optMin: 24, optMax: 30, tMin: 14, tMax: 37,
    doMin: 3,
    sensitivity: 0.8,
    appetite: 0.098, fcr: 1.5,
    startWeight: 10, maxWeight: 900, harvestWeight: 400,
    priceFingerling: 1.0, pricePerKg: 7,
    body: '#8b98a3', belly: '#c9d0d4', fin: '#a3626a',
    info: 'Robust und schnellwüchsig, braucht aber warmes Wasser (24–30 °C). Ohne Heizung im Winter schwierig.',
  },
  karpfen: {
    id: 'karpfen',
    name: 'Karpfen',
    optMin: 18, optMax: 26, tMin: 3, tMax: 32,
    doMin: 3,
    sensitivity: 0.9,
    appetite: 0.075, fcr: 1.7,
    startWeight: 20, maxWeight: 2500, harvestWeight: 1000,
    priceFingerling: 1.5, pricePerKg: 6,
    body: '#b08a3e', belly: '#e2c88a', fin: '#8f6a2a',
    info: 'Sehr anspruchslos und verträgt Kälte. Wächst langsamer, ideal für Anfänger.',
  },
  forelle: {
    id: 'forelle',
    name: 'Regenbogenforelle',
    optMin: 10, optMax: 16, tMin: 2, tMax: 22,
    doMin: 6,
    sensitivity: 1.6,
    appetite: 0.1, fcr: 1.2,
    startWeight: 15, maxWeight: 1500, harvestWeight: 350,
    priceFingerling: 1.6, pricePerKg: 12,
    body: '#9aa4a0', belly: '#e8ece9', fin: '#c97a86',
    info: 'Wertvoll, braucht aber kühles, sehr sauberes und sauerstoffreiches Wasser. Über 20 °C wird es kritisch.',
  },
  wels: {
    id: 'wels',
    name: 'Afrikanischer Wels',
    optMin: 24, optMax: 30, tMin: 15, tMax: 35,
    doMin: 1,
    sensitivity: 0.6,
    appetite: 0.12, fcr: 1.3,
    startWeight: 10, maxWeight: 2000, harvestWeight: 600,
    priceFingerling: 1.0, pricePerKg: 6,
    body: '#4e5052', belly: '#8d8a84', fin: '#3d3e40',
    info: 'Atmet zusätzlich Luft und verträgt wenig Sauerstoff. Sehr schnellwüchsig, braucht Wärme.',
  },
}

export interface PlantSpecies {
  id: PlantId
  name: string
  /** Wohlfühlbereich Temperatur (Luft, °C) */
  optMin: number
  optMax: number
  tMin: number
  tMax: number
  /** Gewicht beim Einpflanzen (g) */
  startMass: number
  /** Erntegewicht (g) */
  harvestMass: number
  /** Tage bis zur Ernte unter idealen Bedingungen */
  days: number
  /** Stickstoffgehalt (mg N pro g Frischmasse) */
  nContent: number
  priceSeedling: number
  /** Verkaufspreis pro Stück bei Erntegewicht; bei Tomate pro kg Früchte */
  price: number
  fruiting?: { startDay: number; gramsPerLightHour: number }
  info: string
}

export const PLANTS: Record<PlantId, PlantSpecies> = {
  salat: {
    id: 'salat', name: 'Salat',
    optMin: 12, optMax: 24, tMin: 2, tMax: 32,
    startMass: 5, harvestMass: 250, days: 35, nContent: 2.4,
    priceSeedling: 0.4, price: 1.8,
    info: 'Der Klassiker in der Aquaponik. Mag es eher kühl, schießt bei Hitze.',
  },
  basilikum: {
    id: 'basilikum', name: 'Basilikum',
    optMin: 20, optMax: 28, tMin: 10, tMax: 35,
    startMass: 3, harvestMass: 120, days: 40, nContent: 3,
    priceSeedling: 0.6, price: 2.5,
    info: 'Braucht Wärme. Unter 12 °C wächst er kaum.',
  },
  minze: {
    id: 'minze', name: 'Minze',
    optMin: 14, optMax: 26, tMin: 0, tMax: 32,
    startMass: 3, harvestMass: 110, days: 42, nContent: 2.6,
    priceSeedling: 0.6, price: 2.0,
    info: 'Unkompliziert und robust.',
  },
  mangold: {
    id: 'mangold', name: 'Mangold',
    optMin: 12, optMax: 24, tMin: 0, tMax: 30,
    startMass: 5, harvestMass: 400, days: 50, nContent: 2.2,
    priceSeedling: 0.5, price: 2.5,
    info: 'Robust, verträgt Kälte und höheren pH-Wert ganz gut.',
  },
  tomate: {
    id: 'tomate', name: 'Tomate',
    optMin: 18, optMax: 28, tMin: 8, tMax: 34,
    startMass: 8, harvestMass: 1200, days: 55, nContent: 2.8,
    priceSeedling: 1.5, price: 3.5,
    fruiting: { startDay: 55, gramsPerLightHour: 2.2 },
    info: 'Trägt ab etwa Tag 55 laufend Früchte. Braucht viele Nährstoffe und genug Eisen.',
  },
}

export const FISH_IDS = Object.keys(FISH) as FishId[]
export const PLANT_IDS = Object.keys(PLANTS) as PlantId[]

/** Leitungswasser */
export const TAP = { kh: 6, tan: 0, no2: 0, no3: 0.5, fe: 0.02, temp: 12, co2: 3 }

export const PRICES = {
  feedKg: 2.5,
  testKit: 9, // 20 Messungen
  buffer: 0.6, // pro 1000 L und +1 °dKH
  iron: 1.2, // pro 1000 L und +1 mg/L
  ammonia: 1.5, // pro 1000 L und +2 mg/L
  starter: 15,
  heater: 45,
  airPump: [0, 30, 70, 150],
  autoFeeder: 60,
  probes: 250,
  bed: 120,
  tank: [0, 300, 900],
  waterPerLiter: 0.004,
  kWh: 0.35,
  /** Gas für die Gewächshausheizung pro kWh */
  gasKWh: 0.12,
  /** Diesel fürs Notstromaggregat pro Betriebsstunde */
  generatorHour: 1.5,
  /** Salz pro kg (1 kg = +1 g/L in 1000 L) */
  saltKg: 0.6,
  beneficials: 25,
  mechFilter: [0, 180, 900],
  mbbr: 350,
  degasser: 260,
  uv: 160,
  oxygen: 1200,
  generator: 700,
  batteryAir: 35,
  mineralizer: 220,
  doser: 480,
  airHeater: 650,
  climate: 550,
  led: 900,
  insectNet: 120,
}

export const MAX_MBBR = 3
/** Fassungsvermögen des Radialabscheiders (g Schlamm) */
export const SLUDGE_CAP = 3000

export const TANK_SIZES = [1000, 2000, 4000]
export const MAX_BEDS = 4
export const SLOTS_PER_BED = 18
export const AIR_KLA = [0, 0.4, 0.8, 1.4]
export const AIR_WATT = [0, 5, 12, 25]
