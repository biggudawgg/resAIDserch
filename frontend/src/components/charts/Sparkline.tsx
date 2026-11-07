import { useRef, useState, type PointerEvent } from 'react'
import { useElementWidth } from '../../lib/hooks'

export interface SparkPoint {
  t: number
  v: number
  label: string
  detail: string
}

export function Sparkline({
  points,
  height = 64,
  ariaLabel,
  formatValue,
}: {
  points: SparkPoint[]
  height?: number
  ariaLabel: string
  formatValue: (value: number) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const [active, setActive] = useState<number | null>(null)
  if (!points.length) return null

  const pad = { l: 8, r: 8, t: 10, b: 8 }
  const times = points.map((p) => p.t)
  const values = points.map((p) => p.v)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const lo = Math.max(0, Math.min(...values) - 0.1)
  const hi = Math.min(1, Math.max(...values) + 0.05)
  const x = (t: number) => (t1 === t0 ? width / 2 : pad.l + ((t - t0) / (t1 - t0)) * (width - pad.l - pad.r))
  const y = (v: number) => (hi === lo ? height / 2 : pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b))
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const baseline = height - pad.b
  const area = `${line}L${x(points[points.length - 1].t).toFixed(1)},${baseline}L${x(points[0].t).toFixed(1)},${baseline}Z`
  const shown = active ?? points.length - 1

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[best].t) - px)) best = i
    })
    setActive(best)
  }

  return (
    <div className="spark" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <path className="spark-area" d={area} />
          <path className="spark-line" d={line} />
          {active !== null && <line className="spark-cross" x1={x(points[active].t)} x2={x(points[active].t)} y1={pad.t - 6} y2={baseline} />}
          <circle className="spark-dot" cx={x(points[shown].t)} cy={y(points[shown].v)} r={4} />
          <rect x={0} y={0} width={width} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {active !== null && (
        <div className="chart-tooltip" style={{ left: Math.min(Math.max(x(points[active].t), 90), width - 90), top: y(points[active].v) }}>
          <strong>{formatValue(points[active].v)}</strong>
          <span>{points[active].label}</span>
          <span className="tooltip-muted">{points[active].detail}</span>
        </div>
      )}
    </div>
  )
}
