// Wasserchemie: pH aus Karbonathärte und CO2, freies Ammoniak, Sauerstoffsättigung.

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)

/** pH aus Hydrogencarbonat-Puffer (KH) und gelöstem CO2 (Henderson-Hasselbalch). */
export function phOf(kh: number, co2: number) {
  const hco3 = Math.max(kh, 0.02) * 0.357 // mmol/L
  const co2mmol = Math.max(co2, 0.3) / 44
  return clamp(6.35 + Math.log10(hco3 / co2mmol), 4.5, 9.2)
}

/** Anteil des giftigen, freien Ammoniaks (NH3) am Gesamt-Ammonium. */
export function nh3Fraction(ph: number, temp: number) {
  const pKa = 0.09018 + 2729.92 / (temp + 273.15)
  return 1 / (1 + Math.pow(10, pKa - ph))
}

/** Sauerstoffsättigung von Süßwasser (mg/L) */
export function o2Saturation(temp: number) {
  const t = clamp(temp, 0, 40)
  return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t
}

/** Lufttemperatur im Gewächshaus nach Jahreszeit und Uhrzeit */
export function airTemp(doy: number, hour: number) {
  const season = 13 + 10 * Math.sin((2 * Math.PI * (doy - 110)) / 365)
  const daily = 4 * Math.sin((2 * Math.PI * (hour - 9)) / 24)
  return season + 2 + daily
}

/** Licht 0–1 (Tageslänge nach Jahreszeit) */
export function daylight(doy: number, hour: number) {
  const dayLen = 12 + 4 * Math.sin((2 * Math.PI * (doy - 80)) / 365)
  const rise = 13 - dayLen / 2
  const set = 13 + dayLen / 2
  if (hour <= rise || hour >= set) return 0
  return Math.sin((Math.PI * (hour - rise)) / dayLen)
}

export function dayOfYear(startDoy: number, t: number) {
  return ((startDoy - 1 + Math.floor(t / 24)) % 365) + 1
}

/** Temperatur-Wohlfühlfaktor: 1 im Optimum, linear auf 0 an den Grenzen */
export function tempFactor(temp: number, tMin: number, optMin: number, optMax: number, tMax: number) {
  if (temp < optMin) return clamp((temp - tMin) / (optMin - tMin))
  if (temp > optMax) return clamp((tMax - temp) / (tMax - optMax))
  return 1
}
