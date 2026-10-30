import { dayOfYear } from '../sim/chemistry.ts'

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function dateLabel(startDoy: number, t: number) {
  let doy = dayOfYear(startDoy, t)
  let m = 0
  while (doy > MONTH_DAYS[m]) {
    doy -= MONTH_DAYS[m]
    m++
  }
  return `${doy}. ${MONTHS[m]}`
}

export function clock(t: number) {
  const h = Math.floor(t % 24)
  const min = Math.floor((t % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function dayNo(t: number) {
  return Math.floor(t / 24) + 1
}

export function stamp(t: number) {
  return `Tag ${dayNo(t)}, ${clock(t)}`
}

export const eur = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
export const num = (v: number, d = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })
export const grams = (g: number) => (g >= 1000 ? `${num(g / 1000, 2)} kg` : `${Math.round(g)} g`)
