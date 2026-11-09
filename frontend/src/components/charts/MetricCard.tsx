/**
 * Metric Card, ported from KokonutUI (Tailwind) to this app's CSS and tokens.
 *
 * Original: "Metric Card" v2.0.0 by @dorianbaffier, https://kokonutui.com/docs/cards/metric-card
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: segments carry their own colours and the line takes the focused segment's colour; the
 * value format is configurable (cents for small spend); a rise can be marked bad (spend); card chrome is left to the
 * parent; styling uses CSS classes and design tokens.
 */
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cx } from '../../lib/cx'

// The chart's drawing box; it stretches to the card's width.
const W = 400
const H = 120
const PAD_Y = 10
// Every period is resampled to this many points, so one shape can morph into another.
const SAMPLES = 90
const MORPH_MS = 420
const DIGIT = /\d/
const SNAP_PX = 6
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export interface MetricPoint {
  /** YYYY-MM-DD */
  date: string
  /** One value per segment, in the order of `segments`. */
  parts: number[]
}

export interface MetricEvent {
  /** YYYY-MM-DD */
  date: string
  label: string
}

export interface MetricSegment {
  name: string
  /** Any CSS colour, e.g. 'var(--series-claude)'. */
  color: string
}

interface Span {
  lo: number
  hi: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)

const formatDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const formatShort = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Linear resample of `values` to `count` evenly spaced points. */
function resample(values: number[], count: number) {
  // Too little history (no previous period yet): a flat line on the floor.
  if (values.length === 0) return new Array<number>(count).fill(0)
  const out = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    const at = (i / (count - 1)) * (values.length - 1)
    const lo = Math.floor(at)
    const hi = Math.min(values.length - 1, lo + 1)
    out[i] = values[lo] + (values[hi] - values[lo]) * (at - lo)
  }
  return out
}

const yOf = (height: number) => PAD_Y + (1 - height) * (H - PAD_Y * 2)

/**
 * Heights 0..1 to an SVG path, smoothed with a monotone cubic (Steffen's method, as in d3's curveMonotoneX).
 * Unlike a Catmull-Rom spline it never overshoots between days, so the line can't dip below zero or peak above a
 * value that was never spent.
 */
function toPath(heights: number[]) {
  if (heights.length === 0) return ''
  const pts = heights.map((h, i) => [(i / Math.max(1, heights.length - 1)) * W, yOf(h)])
  const n = pts.length
  const fmt = (p: number[]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`
  if (n === 1) return `M${fmt(pts[0])}`
  // Secant slope of each segment, then a tangent per point clamped so no segment leaves its two end values.
  const secant = pts.slice(0, -1).map((p, i) => (pts[i + 1][1] - p[1]) / (pts[i + 1][0] - p[0]))
  const tangent = pts.map((_, i) => {
    if (i === 0) return secant[0]
    if (i === n - 1) return secant[n - 2]
    const s0 = secant[i - 1]
    const s1 = secant[i]
    if (s0 * s1 <= 0) return 0
    const h0 = pts[i][0] - pts[i - 1][0]
    const h1 = pts[i + 1][0] - pts[i][0]
    const blend = (s0 * h1 + s1 * h0) / (h0 + h1)
    return Math.sign(s0) * Math.min(Math.abs(s0), Math.abs(s1), Math.abs(blend) / 2) * 2
  })
  let d = `M${fmt(pts[0])}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const third = (x1 - x0) / 3
    d += `C${fmt([x0 + third, y0 + tangent[i] * third])} ${fmt([x1 - third, y1 - tangent[i + 1] * third])} ${fmt([x1, y1])}`
  }
  return d
}

/** The line closed down to the baseline. */
const toArea = (line: string) => `${line}L${W} ${H}L0 ${H}Z`

interface Shape {
  current: number[]
  previous: number[]
}

interface Paths {
  current: string
  previous: string
}

/** One period's numbers and its shape, for the whole metric or one segment. */
function buildPeriod(data: MetricPoint[], days: number, focus: number | null) {
  const current = data.slice(-days)
  const previous = data.slice(-days * 2, -days)
  const pick = (p: MetricPoint) => (focus === null ? sum(p.parts) : (p.parts[focus] ?? 0))
  const now = current.map(pick)
  const before = previous.map(pick)
  const all = [...now, ...before]
  const lo = Math.min(...all, 0) * 0.85
  const hi = Math.max(...all, 0) * 1.04
  const norm = (v: number) => (v - lo) / (hi - lo || 1)
  return {
    current,
    previous,
    now,
    before,
    shape: { current: resample(now.map(norm), SAMPLES), previous: resample(before.map(norm), SAMPLES) } as Shape,
    paths: { current: toPath(now.map(norm)), previous: toPath(before.map(norm)) } as Paths,
    norm,
  }
}

const total = (values: number[], span: Span | null) => sum(span ? values.slice(span.lo, span.hi + 1) : values)

function breakdown(points: MetricPoint[], span: Span | null, count: number) {
  const parts = new Array<number>(count).fill(0)
  const days = span ? points.slice(span.lo, span.hi + 1) : points
  for (const point of days) for (let i = 0; i < count; i++) parts[i] += point.parts[i] ?? 0
  return parts
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Each digit rolls on its own wheel; separators sit still. */
function RollingNumber({ value }: { value: string }) {
  const chars = value.split('')
  return (
    <span aria-hidden className="mcard-roll">
      {chars.map((char, i) => {
        // Keyed from the right, so units stay put when the length changes.
        const key = chars.length - i
        if (!DIGIT.test(char)) return <span key={`s${key}`}>{char}</span>
        return (
          <span className="mcard-digit" key={`d${key}`}>
            <span className="mcard-digit-sizer">0</span>
            <span className="mcard-digit-wheel" style={{ transform: `translateY(-${Number(char) * 10}%)` }}>
              {DIGITS.map((d) => (
                <span className="mcard-digit-face" key={d}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

type Period = ReturnType<typeof buildPeriod>

/** A range once the drag covers two days or more, else the cursor's day. */
function spanOf(range: { a: number; b: number } | null, cursor: number | null, last: number): { span: Span | null; ranged: boolean } {
  if (range && range.a !== range.b) return { span: { lo: Math.min(range.a, range.b), hi: Math.max(range.a, range.b) }, ranged: true }
  if (cursor !== null && cursor <= last) return { span: { lo: cursor, hi: cursor }, ranged: false }
  return { span: null, ranged: false }
}

/** What the card reads: a range, one day, or the whole period. */
function readOf(info: Period, span: Span | null, ranged: boolean, period: number, events: MetricEvent[]) {
  const day = span && !ranged ? info.current[span.lo] : undefined
  const twin = span && !ranged ? info.previous[span.lo] : undefined
  const value = total(info.now, span)
  const compare = total(info.before, span)
  const event = day ? events.find((e) => e.date === day.date) : undefined
  let caption = `vs previous ${period} days`
  if (ranged && span) {
    const days = span.hi - span.lo + 1
    caption = `${formatShort(info.current[span.lo].date)} – ${formatShort(info.current[span.hi].date)} vs prior ${days} days`
  } else if (day) {
    caption = `${formatDay(day.date)} vs ${formatShort(twin?.date ?? day.date)}`
  }
  return { day, twin, value, delta: compare ? (value - compare) / compare : null, event, caption }
}

/** Arrow keys walk the days; with Shift they stretch a range from the cursor. */
function keyStep(key: string, last: number) {
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -last, End: last }
  return moves[key]
}

export function MetricCard({
  label,
  segments,
  data,
  events = [],
  periods = [7, 14],
  defaultPeriod = 14,
  format,
  riseIsGood = true,
  className,
}: {
  label: string
  segments: MetricSegment[]
  /** Daily values, oldest first. Needs twice the longest period, so each period has one to compare with. */
  data: MetricPoint[]
  /** Days worth a note, pinned on the chart. */
  events?: MetricEvent[]
  periods?: number[]
  defaultPeriod?: number
  format: (value: number) => string
  /** Spend going up is bad: set false to colour a rise red. */
  riseIsGood?: boolean
  className?: string
}) {
  const clipId = `${useId().replace(/:/g, '')}-lit`
  const [period, setPeriod] = useState(defaultPeriod)
  const [focus, setFocus] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [range, setRange] = useState<{ a: number; b: number } | null>(null)
  const drag = useRef<number | null>(null)
  const info = useMemo(() => buildPeriod(data, period, focus), [data, period, focus])

  const currentRef = useRef<SVGPathElement>(null)
  const currentDimRef = useRef<SVGPathElement>(null)
  const areaRef = useRef<SVGPathElement>(null)
  const previousRef = useRef<SVGPathElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const shown = useRef<Shape>(info.shape)
  const morph = useRef({ raf: 0 })

  // A new period or segment morphs the lines from where they are now.
  useEffect(() => {
    const from = shown.current
    const to = info.shape
    const m = morph.current
    cancelAnimationFrame(m.raf)
    const paint = (paths: Paths) => {
      currentRef.current?.setAttribute('d', paths.current)
      currentDimRef.current?.setAttribute('d', paths.current)
      areaRef.current?.setAttribute('d', toArea(paths.current))
      previousRef.current?.setAttribute('d', paths.previous)
    }
    const land = () => {
      shown.current = to
      paint(info.paths)
    }
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      land()
      return
    }
    const start = performance.now()
    const frame = (now: number) => {
      const t = easeInOut(Math.min(1, (now - start) / MORPH_MS))
      const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * t)
      shown.current = { current: mix(from.current, to.current), previous: mix(from.previous, to.previous) }
      if (t < 1) {
        paint({ current: toPath(shown.current.current), previous: toPath(shown.current.previous) })
        m.raf = requestAnimationFrame(frame)
      } else {
        land()
      }
    }
    m.raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(m.raf)
  }, [info.shape, info.paths])

  const last = info.current.length - 1

  const pinned = useMemo(
    () => events.map((e) => ({ ...e, at: info.current.findIndex((p) => p.date === e.date) })).filter((e) => e.at >= 0),
    [events, info],
  )

  const indexAt = useCallback(
    (clientX: number) => {
      const rect = chartRef.current?.getBoundingClientRect()
      if (!rect) return 0
      const t = clamp((clientX - rect.left) / rect.width, 0, 1)
      // Pinned days pull the cursor in, so their notes are easy to land on.
      const near = pinned.find((e) => Math.abs((e.at / (last || 1) - t) * rect.width) < SNAP_PX)
      return near ? near.at : Math.round(t * last)
    },
    [last, pinned],
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = indexAt(event.clientX)
    drag.current = at
    setRange(null)
    setCursor(at)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = indexAt(event.clientX)
    if (drag.current !== null) {
      // Dragging past the first day turns the read into a range.
      const anchor = drag.current
      setRange((r) => (r || at !== anchor ? { a: anchor, b: at } : null))
      setCursor(at)
    } else if (event.pointerType === 'mouse' && !range) {
      setCursor(at)
    }
  }

  const release = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (event.pointerType !== 'mouse') setCursor(null)
  }

  const clearRead = () => {
    setRange(null)
    setCursor(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      clearRead()
      return
    }
    const move = keyStep(event.key, last)
    if (move === undefined) return
    event.preventDefault()
    const from = range ? range.b : (cursor ?? last)
    const to = clamp(from + move, 0, last)
    if (event.shiftKey) setRange({ a: range ? range.a : from, b: to })
    else setRange(null)
    setCursor(to)
  }

  const { span, ranged } = spanOf(range, cursor, last)
  const { day, twin, value, delta, event, caption } = readOf(info, span, ranged, period, events)
  const up = (delta ?? 0) >= 0
  const good = riseIsGood ? up : !up
  const parts = breakdown(info.current, span, segments.length)
  const partsTotal = sum(parts)
  const formatted = format(value)
  let valueText = `${formatted} in total`
  if (ranged) valueText = `${caption}: ${formatted}`
  else if (day) valueText = `${formatDay(day.date)}: ${formatted}${event ? `, ${event.label}` : ''}`

  const xOf = (i: number) => (last ? (i / last) * W : W)
  const pct = (i: number) => (xOf(i) / W) * 100
  const litFrom = ranged && span ? xOf(span.lo) : 0
  const litTo = span ? xOf(span.hi) : W
  const endY = info.now.length ? yOf(info.norm(info.now[last])) : 0
  const firstDay = info.current[0]
  const lastDay = info.current[info.current.length - 1]
  const periodIndex = Math.max(0, periods.indexOf(period))
  const ink = focus === null ? 'var(--accent)' : segments[focus].color

  return (
    <div className={cx('mcard', className)} style={{ '--mcard-ink': ink } as CSSProperties}>
      <div className="mcard-head">
        <p className="mcard-label">
          {label}
          {focus !== null && <span className="mcard-focus"> · {segments[focus].name}</span>}
        </p>
        <div className="mcard-periods">
          {/* One pill slides between the periods. */}
          <span aria-hidden className="mcard-period-pill" style={{ transform: `translateX(${periodIndex * 100}%)` }} />
          {periods.map((days) => (
            <button
              aria-pressed={days === period}
              className={cx('mcard-period', days === period && 'is-on')}
              key={days}
              onClick={() => {
                clearRead()
                setPeriod(days)
              }}
              type="button"
            >
              {days}D
            </button>
          ))}
        </div>
      </div>

      <p className="mcard-value">
        <span className="sr-only">{formatted}</span>
        <RollingNumber value={formatted} />
      </p>
      <div className="mcard-delta-row">
        {delta !== null ? (
          <span className={cx('mcard-delta', good ? 'is-good' : 'is-bad')}>
            {up ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="mcard-delta">New</span>
        )}
        <span aria-live="polite" className="mcard-caption">
          {caption}
          {event && <span className="mcard-event-label"> · {event.label}</span>}
        </span>
        {ranged && (
          <button className="mcard-clear" onClick={clearRead} type="button">
            Clear
          </button>
        )}
      </div>

      <div
        aria-label={`${label} over the last ${period} days. Arrow keys read each day; hold Shift to select a range.`}
        aria-valuemax={info.current.length}
        aria-valuemin={1}
        aria-valuenow={span ? span.hi + 1 : info.current.length}
        aria-valuetext={valueText}
        className="mcard-chart"
        onBlur={() => setCursor(null)}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={release}
        onPointerCancel={release}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          if (drag.current === null && !range) setCursor(null)
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={release}
        ref={chartRef}
        role="slider"
        tabIndex={0}
      >
        <svg aria-hidden className="mcard-svg" preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <clipPath id={clipId}>
              <rect height={H + 20} width={Math.max(0, litTo - litFrom)} x={litFrom} y={-10} />
            </clipPath>
            <linearGradient id={`${clipId}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={ink} stopOpacity="0.22" />
              <stop offset="1" stopColor={ink} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line className="mcard-base" vectorEffect="non-scaling-stroke" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} />
          <path className="mcard-prev" d={info.paths.previous} ref={previousRef} strokeDasharray="3 4" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
          {/* The area only fills the part being read. */}
          <path clipPath={`url(#${clipId})`} d={toArea(info.paths.current)} fill={`url(#${clipId}-fill)`} ref={areaRef} />
          <path className="mcard-line-dim" d={info.paths.current} ref={currentDimRef} strokeLinecap="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path className="mcard-line" clipPath={`url(#${clipId})`} d={info.paths.current} ref={currentRef} strokeLinecap="round" strokeWidth={2.25} vectorEffect="non-scaling-stroke" />
        </svg>

        {pinned.map((e) => (
          <div aria-hidden className="mcard-event" key={e.date} style={{ left: `${pct(e.at)}%` }}>
            <div className="mcard-event-line" />
            <div className="mcard-event-dot" />
          </div>
        ))}

        {ranged && span && [span.lo, span.hi].map((i) => <div aria-hidden className="mcard-range-edge" key={i} style={{ left: `${pct(i)}%` }} />)}

        {day && span && (
          <>
            <div aria-hidden className="mcard-cursor" style={{ left: `${pct(span.lo)}%` }} />
            {twin && (
              <div
                aria-hidden
                className="mcard-twin"
                style={{ left: `${pct(span.lo)}%`, top: `${(yOf(info.norm(info.before[span.lo])) / H) * 100}%` }}
              />
            )}
            <div aria-hidden className="mcard-dot" style={{ left: `${pct(span.lo)}%`, top: `${(yOf(info.norm(info.now[span.lo])) / H) * 100}%` }} />
          </>
        )}

        {/* Today, at rest. It rides the morph to the new end. */}
        <div aria-hidden className={cx('mcard-today', span && 'is-hidden')} style={{ top: `${(endY / H) * 100}%` }} />
      </div>

      <div className="mcard-axis">
        <span>{firstDay ? formatShort(firstDay.date) : ''}</span>
        <span className="mcard-legend">
          <span className="mcard-legend-dash" />
          Previous period
        </span>
        <span>{lastDay ? formatShort(lastDay.date) : ''}</span>
      </div>

      {/* Each segment's share of what the card reads. Pick one to chart it alone. */}
      <div className="mcard-breakdown">
        <div aria-hidden className="mcard-bar">
          {segments.map((s, i) => (
            <span className={cx('mcard-bar-part', focus !== null && focus !== i && 'is-dim')} key={s.name} style={{ flexGrow: parts[i] ?? 0, background: s.color }} />
          ))}
        </div>
        <ul className="mcard-segments">
          {segments.map((s, i) => {
            const share = partsTotal ? (parts[i] / partsTotal) * 100 : 0
            return (
              <li key={s.name}>
                <button
                  aria-label={focus === i ? `Show all of ${label}` : `Show only ${s.name}`}
                  aria-pressed={focus === i}
                  className={cx('mcard-seg', focus === i && 'is-on', focus !== null && focus !== i && 'is-dim')}
                  onClick={() => setFocus((f) => (f === i ? null : i))}
                  type="button"
                >
                  <span className="mcard-swatch" style={{ background: s.color }} />
                  <span className="mcard-seg-name">{s.name}</span>
                  <span className="mcard-seg-value">{format(parts[i] ?? 0)}</span>
                  <span className="mcard-seg-share">{share.toFixed(0)}%</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
