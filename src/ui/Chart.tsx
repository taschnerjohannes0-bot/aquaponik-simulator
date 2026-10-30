import type { Reading } from '../sim/state.ts'
import { dayNo } from './format.ts'

export interface Series {
  key: keyof Reading
  label: string
  color: string
  /** Faktor für die Darstellung, z. B. Nitrat geteilt durch 10 */
  scale?: number
}

export function Chart({ readings, series, height = 140, title }: { readings: Reading[]; series: Series[]; height?: number; title: string }) {
  const W = 320
  const H = height
  const pad = { l: 30, r: 8, t: 8, b: 20 }
  if (readings.length < 2) {
    return (
      <div className="chart empty">
        <div className="chart-title">{title}</div>
        <p>Noch zu wenige Messungen. Teste das Wasser öfter, dann siehst du hier den Verlauf.</p>
      </div>
    )
  }
  const t0 = readings[0].t
  const t1 = readings[readings.length - 1].t
  let max = 0
  let min = Infinity
  for (const r of readings)
    for (const s of series) {
      const v = (r[s.key] as number) * (s.scale ?? 1)
      if (v > max) max = v
      if (v < min) min = v
    }
  const isPh = series.length === 1 && series[0].key === 'ph'
  const lo = isPh ? Math.floor(Math.min(min, 6)) : 0
  const hi = isPh ? Math.ceil(Math.max(max, 8)) : Math.max(1, max * 1.1)
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="tick">
              {v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="tick">
          Tag {dayNo(t0)}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="tick">
          Tag {dayNo(t1)}
        </text>
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            points={readings.map((r) => `${x(r.t).toFixed(1)},${y((r[s.key] as number) * (s.scale ?? 1)).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
