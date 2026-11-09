/**
 * Theme lamp, ported from KokonutUI's Pull Cord (Tailwind) to this app's CSS.
 *
 * Original: "Pull Cord" v1.0.0 by @dorianbaffier, https://kokonutui.com/docs/buttons/pull-cord
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: shrunk from a 288×360 card to a small lamp hanging from the top bar, whose cord dangles
 * just below the bar; it drives the app theme (lamp lit = light theme); colours come from design tokens; only the cord
 * and bead take pointer events, so the page under the dangling cord stays clickable. The physics are unchanged:
 * a Verlet chain with fixed-length links and a little bend stiffness, a click once per pull (not on release), a damped
 * stretch past the cord's length, a fixed time step, and a loop that sleeps at rest.
 */
import { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '../../lib/cx'
import { useTheme } from '../../lib/theme'

const WIDTH = 44
const HEIGHT = 112
// Where the cord hangs from, just under the shade's right edge.
const ANCHOR = { x: WIDTH / 2 + 8, y: 30 }
// The cord is a chain of points joined by fixed-length links.
const LINKS = 9
const LINK = 5.2
const STEP = 1 / 120
const GRAVITY = 1100
const DAMPING = 0.99
// Fastest a link may move in one step, so letting go of a stretched cord doesn't fling it into the shade.
const MAX_SPEED = 3
// Two links apart, points never get closer than this, so the cord bends in curves instead of folding.
const BEND_MIN = LINK * 1.9
const BEND_STIFFNESS = 0.8
const ITERATIONS = 14
// How far past its length the cord must be pulled to click, and how far it can stretch at all.
const CLICK_PULL = 13
const MAX_STRETCH = 22
const REST_EPSILON = 0.012
const REST_STEPS = 24

function damp(distance: number, max: number) {
  return max * (1 - Math.exp(-distance / max))
}

function haptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(8)
}

/** Move points a and b towards `length` apart. A bend constraint only ever pushes apart, part of the way each pass. */
function relax(chain: { xs: Float64Array; ys: Float64Array; held: number }, a: number, b: number, length: number, bend: boolean) {
  const { xs, ys, held } = chain
  const aFixed = a === 0 || a === held
  const bFixed = b === held
  if (aFixed && bFixed) return
  const dx = xs[b] - xs[a]
  const dy = ys[b] - ys[a]
  const dist = Math.hypot(dx, dy) || 0.0001
  if (bend && dist >= length) return
  const diff = ((dist - length) / dist) * (bend ? BEND_STIFFNESS : 1)
  let wa = 0.5
  if (aFixed) wa = 0
  else if (bFixed) wa = 1
  xs[a] += dx * diff * wa
  ys[a] += dy * diff * wa
  xs[b] -= dx * diff * (1 - wa)
  ys[b] -= dy * diff * (1 - wa)
}

/** A smooth curve through the chain's points. */
function cordPath(xs: Float64Array, ys: Float64Array) {
  let d = `M${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`
  for (let i = 1; i < xs.length - 1; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2
    const my = (ys[i] + ys[i + 1]) / 2
    d += ` Q${xs[i].toFixed(2)} ${ys[i].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`
  }
  const n = xs.length - 1
  d += ` L${xs[n].toFixed(2)} ${ys[n].toFixed(2)}`
  return d
}

function restingChain() {
  const xs = new Float64Array(LINKS + 1)
  const ys = new Float64Array(LINKS + 1)
  for (let i = 0; i <= LINKS; i++) {
    xs[i] = ANCHOR.x
    ys[i] = ANCHOR.y + i * LINK
  }
  return { xs, ys }
}

const REST = restingChain()
const REST_PATH = cordPath(REST.xs, REST.ys)

export function ThemeLamp({ className }: { className?: string }) {
  const { theme, setMode } = useTheme()
  const checked = theme === 'light'
  const [focused, setFocused] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)
  const cordRef = useRef<SVGPathElement>(null)
  const hitRef = useRef<SVGPathElement>(null)
  const beadRef = useRef<SVGGElement>(null)

  const sim = useRef({
    xs: Float64Array.from(REST.xs),
    ys: Float64Array.from(REST.ys),
    pxs: Float64Array.from(REST.xs),
    pys: Float64Array.from(REST.ys),
    raf: 0,
    last: 0,
    carry: 0,
    still: 0,
    // The link being held, and where the hand is holding it.
    held: -1,
    targetX: 0,
    targetY: 0,
    armed: true,
    reduceMotion: false,
  })

  // Read from pointer handlers, which outlive the render they came from.
  const latest = useRef<{ checked: boolean; toggle: (next: boolean) => void }>({ checked, toggle: () => undefined })
  const toggle = useCallback((next: boolean) => setMode(next ? 'light' : 'dark'), [setMode])
  latest.current = { checked, toggle }

  const draw = useCallback(() => {
    const { xs, ys } = sim.current
    const d = cordPath(xs, ys)
    cordRef.current?.setAttribute('d', d)
    hitRef.current?.setAttribute('d', d)
    const n = LINKS
    const angle = (Math.atan2(xs[n] - xs[n - 1], ys[n] - ys[n - 1]) * 180) / Math.PI
    beadRef.current?.setAttribute('transform', `translate(${xs[n].toFixed(2)} ${ys[n].toFixed(2)}) rotate(${(-angle).toFixed(2)})`)
  }, [])

  // Verlet: each free link keeps last step's velocity, plus gravity. The held link goes to the hand.
  const integrate = useCallback(() => {
    const s = sim.current
    const { xs, ys, pxs, pys } = s
    let moved = 0
    for (let i = 1; i <= LINKS; i++) {
      if (i === s.held) continue
      let vx = (xs[i] - pxs[i]) * DAMPING
      let vy = (ys[i] - pys[i]) * DAMPING
      const speed = Math.hypot(vx, vy)
      if (speed > MAX_SPEED) {
        vx *= MAX_SPEED / speed
        vy *= MAX_SPEED / speed
      }
      pxs[i] = xs[i]
      pys[i] = ys[i]
      xs[i] += vx
      ys[i] += vy + GRAVITY * STEP * STEP
      moved = Math.max(moved, Math.abs(vx) + Math.abs(vy))
    }
    if (s.held > 0) {
      const i = s.held
      moved = Math.max(moved, Math.abs(s.targetX - xs[i]) + Math.abs(s.targetY - ys[i]))
      pxs[i] = xs[i]
      pys[i] = ys[i]
      xs[i] = s.targetX
      ys[i] = s.targetY
    }
    return moved
  }, [])

  const constrain = useCallback(() => {
    const s = sim.current
    for (let k = 0; k < ITERATIONS; k++) {
      for (let i = 0; i < LINKS; i++) relax(s, i, i + 1, LINK, false)
      for (let i = 0; i + 2 <= LINKS; i++) relax(s, i, i + 2, BEND_MIN, true)
    }
  }, [])

  const tick = useCallback(
    (now: number) => {
      const s = sim.current
      s.raf = 0
      const elapsed = s.last ? Math.min((now - s.last) / 1000, 0.05) : STEP
      s.last = now
      s.carry += elapsed
      let moved = 0
      while (s.carry >= STEP) {
        moved = Math.max(moved, integrate())
        constrain()
        s.carry -= STEP
      }
      draw()
      s.still = moved < REST_EPSILON ? s.still + 1 : 0
      if (s.held > 0 || s.still < REST_STEPS) s.raf = requestAnimationFrame(tick)
      else s.last = 0
    },
    [draw, integrate, constrain],
  )

  const wake = useCallback(() => {
    const s = sim.current
    s.still = 0
    if (!s.raf) s.raf = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => {
    const s = sim.current
    s.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return () => cancelAnimationFrame(s.raf)
  }, [])

  const localPoint = (event: PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT }
  }

  // The hand can pull the cord a little past its length, with growing resistance, never off the anchor.
  const reach = (index: number, x: number, y: number) => {
    const dx = x - ANCHOR.x
    const dy = y - ANCHOR.y
    const dist = Math.hypot(dx, dy) || 0.0001
    const length = index * LINK
    if (dist <= length) return { x, y, pull: 0 }
    const allowed = length + damp(dist - length, MAX_STRETCH)
    return { x: ANCHOR.x + (dx / dist) * allowed, y: ANCHOR.y + (dy / dist) * allowed, pull: dy > 0 ? (allowed - length) * (dy / dist) : 0 }
  }

  const handlePointerDown = (event: PointerEvent<SVGElement>) => {
    const s = sim.current
    if (s.held > 0) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const point = localPoint(event)
    // Hold the link nearest to where the cord was grabbed.
    let nearest = LINKS
    let best = Number.POSITIVE_INFINITY
    for (let i = 1; i <= LINKS; i++) {
      const d = Math.hypot(s.xs[i] - point.x, s.ys[i] - point.y)
      if (d < best) {
        best = d
        nearest = i
      }
    }
    svgRef.current?.setPointerCapture(event.pointerId)
    s.held = nearest
    s.targetX = s.xs[nearest]
    s.targetY = s.ys[nearest]
    s.armed = true
    setGrabbing(true)
    wake()
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const s = sim.current
    if (s.held < 0) return
    const point = localPoint(event)
    const target = reach(s.held, point.x, point.y)
    s.targetX = target.x
    s.targetY = target.y
    // The switch clicks once per pull, as soon as the cord is pulled far enough. It re-arms when the cord eases back.
    if (s.armed && target.pull > CLICK_PULL) {
      s.armed = false
      haptic()
      latest.current.toggle(!latest.current.checked)
    } else if (!s.armed && target.pull < CLICK_PULL * 0.4) {
      s.armed = true
    }
    wake()
  }

  const handlePointerUp = () => {
    const s = sim.current
    if (s.held < 0) return
    s.held = -1
    setGrabbing(false)
    if (s.reduceMotion) {
      s.xs.set(REST.xs)
      s.ys.set(REST.ys)
      s.pxs.set(REST.xs)
      s.pys.set(REST.ys)
      draw()
      return
    }
    wake()
  }

  const handleKeyToggle = () => {
    toggle(!checked)
    const s = sim.current
    if (!s.reduceMotion) {
      // A small tug on the bead, so the cord answers the key too.
      s.pys[LINKS] = s.ys[LINKS] - 4
      wake()
    }
  }

  const label = checked ? 'Light theme on. Pull the cord for dark' : 'Dark theme on. Pull the cord for light'

  return (
    <div className={cx('lamp', checked ? 'is-on' : 'is-off', grabbing && 'is-grabbing', className)} title={label}>
      <svg
        aria-hidden
        className="lamp-svg"
        height={HEIGHT}
        onLostPointerCapture={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
      >
        {/* Glow under a lit bulb. */}
        <ellipse className="lamp-glow" cx={WIDTH / 2} cy={30} rx={18} ry={9} />
        {/* Ceiling wire and shade. */}
        <line className="lamp-wire" strokeWidth={1.25} x1={WIDTH / 2} x2={WIDTH / 2} y1={0} y2={12} />
        <path className="lamp-shade" d={`M${WIDTH / 2 - 5} 12 h10 l11 13 q1 2 -1.5 2 h-28 q-2.5 0 -1.5 -2 Z`} />
        {/* The bulb, lit or not. */}
        <path className="lamp-bulb" d={`M${WIDTH / 2 - 6} 27 a6 5.5 0 0 0 12 0 Z`} />
        <path className="lamp-cord" d={REST_PATH} fill="none" ref={cordRef} strokeLinecap="round" strokeWidth={1.25} />
        {/* A wider invisible copy of the cord, so it's easy to grab. */}
        <path className="lamp-hit" d={REST_PATH} fill="none" onPointerDown={handlePointerDown} pointerEvents="stroke" ref={hitRef} stroke="transparent" strokeWidth={14} />
        <g className="lamp-bead-group" onPointerDown={handlePointerDown} ref={beadRef} transform={`translate(${ANCHOR.x} ${ANCHOR.y + LINKS * LINK})`}>
          <circle fill="transparent" pointerEvents="all" r={12} />
          {focused && <rect className="lamp-focus" height={18} rx={6} strokeWidth={1.5} width={12} x={-6} y={-3} />}
          <rect className="lamp-bead" height={12} rx={3.5} width={6} x={-3} y={1} />
        </g>
      </svg>
      <button
        aria-checked={checked}
        aria-label="Light theme"
        className="sr-only"
        onBlur={() => setFocused(false)}
        onClick={handleKeyToggle}
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        role="switch"
        type="button"
      />
    </div>
  )
}
