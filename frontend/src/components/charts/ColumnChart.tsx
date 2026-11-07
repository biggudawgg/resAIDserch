import { useRef, useState, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { useElementWidth } from '../../lib/hooks'

export interface ColumnDatum {
  key: string
  label: string
  value: number
  ariaLabel: string
  tooltip: ReactNode
  current?: boolean
}

function niceStep(max: number, count = 4): number {
  if (max <= 0) return 1
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const n = raw / magnitude
  const factor = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return factor * magnitude
}

/** Rounded 4px data-end at the top, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function ColumnChart({
  data,
  height = 220,
  formatTick,
  ariaLabel,
}: {
  data: ColumnDatum[]
  height?: number
  formatTick: (value: number) => string
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const [active, setActive] = useState<number | null>(null)

  const max = Math.max(0, ...data.map((d) => d.value))
  const step = niceStep(max)
  const top = Math.max(step, Math.ceil(max / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Number(t.toFixed(10)))

  const padL = 52
  const padR = 8
  const padT = 12
  const padB = 28
  const plotW = Math.max(0, width - padL - padR)
  const plotH = height - padT - padB
  const band = data.length ? plotW / data.length : 0
  const barW = Math.min(24, Math.max(3, band * 0.62))
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const every = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)))
  const activeDatum = active === null ? null : data[active]

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t} aria-hidden>
              <line className="chart-grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
              <text className="chart-tick" x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = padL + band * i
            const h = (d.value / top) * plotH
            return (
              <g key={d.key}>
                {h > 0.5 && (
                  <path
                    className={cx('chart-bar', d.current && 'is-current', active === i && 'is-active')}
                    d={columnPath(x0 + (band - barW) / 2, y(d.value), barW, h)}
                  />
                )}
                {i % every === 0 && (
                  <text className="chart-tick" x={x0 + band / 2} y={height - 9} textAnchor="middle" aria-hidden>
                    {d.label}
                  </text>
                )}
                <rect
                  className="chart-hit"
                  x={x0}
                  y={padT}
                  width={band}
                  height={plotH}
                  tabIndex={0}
                  role="img"
                  aria-label={d.ariaLabel}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((current) => (current === i ? null : current))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((current) => (current === i ? null : current))}
                />
              </g>
            )
          })}
          <line className="chart-axis" x1={padL} x2={width - padR} y1={y(0)} y2={y(0)} aria-hidden />
        </svg>
      )}
      {activeDatum && active !== null && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(Math.max(padL + band * active + band / 2, 96), width - 96), top: y(activeDatum.value) }}
        >
          {activeDatum.tooltip}
        </div>
      )}
    </div>
  )
}
