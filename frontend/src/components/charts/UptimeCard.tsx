/**
 * Uptime Card, ported from KokonutUI (Tailwind/shadcn) to this app's plain CSS and tokens.
 *
 * Original: "Uptime Card" v1.0.0 by @dorianbaffier, https://kokonutui.com/docs/cards/uptime-card
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: styling moved to CSS classes and design tokens; an incident carries a short `detail`
 * string instead of minutes of impact, and each service can pass its own `uptime` (here: share of calls that
 * succeeded) instead of the minutes-based estimate; "no data" days read "No calls"; card chrome is left to the parent.
 */
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { cx } from '../../lib/cx'

// How much wider the bar under the pointer gets, and how far the swell spreads, in bars.
const MAGNIFY = 5
const SPREAD = 2.4
// Bars ease toward their width at this rate, per second.
const EASE = 18
const DAY = 86_400_000

export type DayStatus = 'up' | 'degraded' | 'down' | 'none'

export interface IncidentUpdate {
  /** HH:MM, local time. */
  time: string
  label: string
  note?: string
}

export interface Incident {
  title: string
  status: Exclude<DayStatus, 'up' | 'none'>
  /** Short impact summary, e.g. "1 of 6 calls failed". */
  detail: string
  updates: IncidentUpdate[]
}

export interface UptimeService {
  name: string
  /** Incidents by day index, 0 being the oldest day shown. */
  incidents?: Record<number, Incident>
  /** Day indexes with no activity at all; they render as "No calls". */
  idle?: Set<number>
  /** Percent shown next to the name; null shows a dash. */
  uptime: number | null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const formatDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

function statusOf(service: UptimeService, day: number): DayStatus {
  const incident = service.incidents?.[day]
  if (incident) return incident.status
  if (service.idle?.has(day)) return 'none'
  return 'up'
}

/** Target widths: a swell around the focus, flat without one. */
function swell(count: number, focus: number | null, out: Float64Array) {
  for (let i = 0; i < count; i++) out[i] = focus === null ? 1 : 1 + MAGNIFY * Math.exp(-(((i - focus) / SPREAD) ** 2))
  return out
}

/** The bar under x (0 to 1) when bars have these widths. */
function barAt(weights: Float64Array, x: number) {
  let total = 0
  for (const w of weights) total += w
  let at = x * total
  for (let i = 0; i < weights.length; i++) {
    at -= weights[i]
    if (at <= 0) return i
  }
  return weights.length - 1
}

function incidentsOn(services: UptimeService[], day: number) {
  return services.flatMap((s) => {
    const incident = s.incidents?.[day]
    return incident ? [{ service: s.name, incident }] : []
  })
}

function describeDay(list: { service: string; incident: Incident }[]) {
  const first = list[0]
  if (!first) return 'No errors'
  const more = list.length > 1 ? `, +${list.length - 1} more` : ''
  return `${first.service}: ${first.incident.detail}${more}`
}

const STATUS_TEXT: Record<DayStatus, string> = { up: 'Operational', degraded: 'Degraded', down: 'Outage', none: 'No calls' }

export function UptimeCard({
  services,
  days,
  endDate,
  okText = 'All systems operational',
  hint = 'Hover a day to see what happened',
  className,
}: {
  services: UptimeService[]
  days: number
  /** The last day shown, as YYYY-MM-DD. */
  endDate: string
  okText?: string
  hint?: string
  className?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const sim = useRef({
    weights: new Float64Array(days).fill(1),
    target: new Float64Array(days).fill(1),
    focus: null as number | null,
    raf: 0,
    last: 0,
    reduceMotion: false,
  })
  if (sim.current.weights.length !== days) {
    sim.current.weights = new Float64Array(days).fill(1)
    sim.current.target = new Float64Array(days).fill(1)
  }

  const end = Date.parse(`${endDate}T00:00:00Z`)
  const dateOf = useCallback((day: number) => end - (days - 1 - day) * DAY, [end, days])
  const openIssues = useMemo(
    () => services.filter((s) => statusOf(s, days - 1) === 'degraded' || statusOf(s, days - 1) === 'down'),
    [services, days],
  )

  // Widths are written straight to the bars, one flex-grow per bar.
  const paint = useCallback(() => {
    const rows = barsRef.current?.querySelectorAll<HTMLElement>('[data-row]')
    const { weights } = sim.current
    for (const row of rows ?? []) {
      const bars = row.children
      for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.flexGrow = weights[i].toFixed(3)
    }
  }, [])

  const tick = useCallback(
    (now: number) => {
      const s = sim.current
      s.raf = 0
      const dt = s.last ? Math.min((now - s.last) / 1000, 1 / 30) : 1 / 60
      s.last = now
      const k = 1 - Math.exp(-EASE * dt)
      let moving = false
      for (let i = 0; i < s.weights.length; i++) {
        const gap = s.target[i] - s.weights[i]
        if (Math.abs(gap) > 0.002) {
          s.weights[i] += gap * k
          moving = true
        } else {
          s.weights[i] = s.target[i]
        }
      }
      paint()
      if (moving) s.raf = requestAnimationFrame(tick)
      else s.last = 0
    },
    [paint],
  )

  const focusOn = useCallback(
    (focus: number | null) => {
      const s = sim.current
      s.focus = focus
      swell(s.weights.length, focus, s.target)
      if (s.reduceMotion) {
        s.weights.set(s.target)
        paint()
      } else if (!s.raf) {
        s.raf = requestAnimationFrame(tick)
      }
    },
    [paint, tick],
  )

  useEffect(() => {
    const s = sim.current
    s.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return () => {
      cancelAnimationFrame(s.raf)
    }
  }, [])

  /** The day under the pointer, found against the swollen layout. */
  const dayAt = (clientX: number) => {
    const rect = barsRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const probe = new Float64Array(days)
    let day = Math.round(x * (days - 1))
    // Centre the swell on the bar that ends up under the pointer.
    for (let pass = 0; pass < 3; pass++) day = barAt(swell(days, day, probe), x)
    return day
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const day = dayAt(event.clientX)
    // Most moves stay on the same bar: skip the re-render and the retarget.
    if (day === active) return
    setActive(day)
    focusOn(day)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture(event.pointerId)
    const day = dayAt(event.clientX)
    setActive(day)
    focusOn(day)
  }

  const handleClick = () => {
    if (active !== null) setPinned((p) => (p === active ? null : active))
  }

  const leave = () => {
    setActive(null)
    focusOn(pinned)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = active ?? pinned ?? days - 1
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -days, End: days }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setPinned((p) => (p === from ? null : from))
      return
    }
    if (event.key === 'Escape') {
      setPinned(null)
      setActive(null)
      focusOn(null)
      return
    }
    const move = moves[event.key]
    if (move === undefined) return
    event.preventDefault()
    const day = clamp(from + move, 0, days - 1)
    setActive(day)
    focusOn(day)
  }

  const shownDay = active ?? pinned
  const summary = shownDay === null ? hint : `${formatDay(dateOf(shownDay))} · ${describeDay(incidentsOn(services, shownDay))}`
  // The log keeps showing the last pinned day while it collapses.
  const lastPinned = useRef<number | null>(null)
  if (pinned !== null) lastPinned.current = pinned
  const logDay = pinned ?? lastPinned.current
  const pinnedIncidents = logDay === null ? [] : incidentsOn(services, logDay)

  return (
    <div className={cx('uptime', className)}>
      <div className="uptime-head">
        {openIssues.length ? (
          <p className="uptime-state is-warn">
            <TriangleAlert aria-hidden />
            {openIssues.length} {openIssues.length > 1 ? 'providers' : 'provider'} with errors today
          </p>
        ) : (
          <p className="uptime-state is-ok">
            <CircleCheck aria-hidden />
            {okText}
          </p>
        )}
      </div>
      <p aria-live="polite" className="uptime-summary">
        {summary}
      </p>

      <div
        aria-label={`Daily status for the last ${days} days. Use the arrow keys to move between days and Enter to open one.`}
        aria-valuemax={days}
        aria-valuemin={1}
        aria-valuenow={(shownDay ?? days - 1) + 1}
        aria-valuetext={summary}
        className="uptime-bars"
        onBlur={() => {
          if (active !== null) leave()
        }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={(event) => {
          // A touch's implicit capture on the bar it started on moves here on pointerdown; that bubbling event is not the end.
          if (event.target === event.currentTarget) leave()
        }}
        onPointerDown={handlePointerDown}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') leave()
        }}
        onPointerMove={handlePointerMove}
        ref={barsRef}
        role="slider"
        tabIndex={0}
      >
        {services.map((service) => (
          <div className="uptime-row" key={service.name}>
            <div className="uptime-row-head">
              <span className="uptime-name">{service.name}</span>
              <span className="uptime-pct">{service.uptime === null ? '—' : `${service.uptime.toFixed(2)}%`}</span>
            </div>
            <div className="uptime-strip" data-row>
              {Array.from({ length: days }, (_, day) => {
                const status = statusOf(service, day)
                return (
                  <div
                    className={cx('uptime-bar', `is-${status}`, shownDay !== null && day !== shownDay && 'is-dim')}
                    // One bar per day, never reordered.
                    key={day}
                    style={{ flexGrow: 1 }}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <div className="uptime-axis">
          <span>{days} days ago</span>
          <span>Today</span>
        </div>
      </div>

      {/* A pinned day opens its incident log. */}
      <div className={cx('uptime-log-wrap', pinned !== null && 'is-open')} {...(pinned === null ? ({ inert: '' } as Record<string, string>) : {})}>
        <div className="uptime-log-clip">
          {logDay !== null && (
            <div className="uptime-log">
              <div className="uptime-log-head">
                <p className="uptime-log-date">{formatDay(dateOf(logDay))}</p>
                <button
                  aria-label="Close day"
                  className="uptime-log-close"
                  onClick={() => {
                    setPinned(null)
                    focusOn(null)
                  }}
                  type="button"
                >
                  <X aria-hidden />
                </button>
              </div>
              {pinnedIncidents.length === 0 && <p className="uptime-log-empty">No errors recorded. Every call that day succeeded.</p>}
              {pinnedIncidents.map(({ service, incident }) => (
                <div className="uptime-incident" key={service}>
                  <p className="uptime-incident-head">
                    <span className={cx('uptime-pill', incident.status === 'down' ? 'is-down' : 'is-degraded')}>
                      {STATUS_TEXT[incident.status]}
                    </span>
                    <span className="uptime-incident-service">{service}</span>
                    <span className="uptime-incident-title">
                      {incident.title} · {incident.detail}
                    </span>
                  </p>
                  <ol className="uptime-timeline">
                    {incident.updates.map((update, i) => (
                      <li key={`${update.time}-${update.label}-${i}`}>
                        <span className="uptime-time">{update.time}</span> <span className="uptime-label">{update.label}</span>
                        {update.note && <span className="uptime-note"> {update.note}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
