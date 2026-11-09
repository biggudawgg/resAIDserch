/**
 * Card Stack ("Throw Deck"), ported from KokonutUI (Tailwind + motion/react) to this app's plain CSS.
 *
 * Original: "Throw Deck" v2.0.0 by @dorianbaffier, https://kokonutui.com/docs/cards/card-stack
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: styling moved to CSS classes and design tokens; cards take arbitrary content instead of
 * artwork + price; a tap calls `onOpen` (the dashboard navigates to the item) instead of opening the built-in details
 * overlay, which removes the motion/react dependency; reduced motion is read with matchMedia.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../../lib/cx'

export interface StackItem {
  id: string
  /** Accessible name for the card button. */
  label: string
  content: ReactNode
}

// Resting pose of each slot. The top card sits straight; the ones beneath keep a fixed tilt, like a pile squared up by hand.
const TILTS = [0, -2, 1.5, -1]
const SLOT_Y = 9
const SLOT_SCALE = 0.035
const MAX_SLOT = TILTS.length - 1
// Dragging rotates the card up to this many degrees across its own width.
const MAX_DRAG_ROTATION = 18
// A release throws the card when it is this fast (px/ms) or this far (share of the card's width). Anything less springs home.
const THROW_VELOCITY = 0.5
const THROW_DISTANCE = 0.35
// Taps that move less than this open the card instead of dragging it.
const TAP_SLOP = 5
// Release velocity is measured over the last stretch of the gesture only.
const VELOCITY_WINDOW = 90
// Springs as stiffness / damping (per second).
const HOME = { k: 420, c: 30 }
const FLIGHT = { k: 150, c: 15 }
const RETURN = { k: 240, c: 26 }
const TOP_Z = 1000

type Phase = 'rest' | 'drag' | 'out' | 'return'

interface Pose {
  x: number
  y: number
  r: number
  s: number
}

interface Body extends Pose {
  vx: number
  vy: number
  vr: number
  vs: number
  phase: Phase
  /** Where a thrown card is headed before it turns around. */
  out: Pose
  /** Unit direction of the throw. */
  dx: number
  dy: number
  /** Z-index override while in flight. */
  z: number | null
  /** Z-index to take at the top of the arc. */
  apexZ: number | null
}

interface Drag {
  pointerId: number
  index: number
  startX: number
  startY: number
  baseX: number
  baseY: number
  width: number
  /** +1 when grabbed in the top half, −1 in the bottom half. */
  lever: number
  moved: boolean
  samples: { t: number; x: number; y: number }[]
}

function slotPose(depth: number): Pose {
  const d = Math.min(depth, MAX_SLOT)
  return { x: 0, y: d * SLOT_Y, r: TILTS[d] ?? 0, s: 1 - d * SLOT_SCALE }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: a.r + (b.r - a.r) * t, s: a.s + (b.s - a.s) * t }
}

function poseTransform({ x, y, r, s }: Pose) {
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`
}

function makeBody(depth: number): Body {
  const pose = slotPose(depth)
  return { ...pose, vx: 0, vy: 0, vr: 0, vs: 0, phase: 'rest', out: pose, dx: 1, dy: 0, z: null, apexZ: null }
}

function springAxis(value: number, velocity: number, target: number, spring: { k: number; c: number }, dt: number) {
  const accel = -spring.k * (value - target) - spring.c * velocity
  const v = velocity + accel * dt
  return [value + v * dt, v] as const
}

function stepBody(body: Body, target: Pose, dt: number) {
  let spring = HOME
  if (body.phase === 'out') spring = FLIGHT
  else if (body.phase === 'return') spring = RETURN
  // Sub-step so a stiff spring stays stable on a slow frame.
  const steps = Math.max(1, Math.ceil(dt * 240))
  const h = dt / steps
  const axes = [
    ['x', 'vx'],
    ['y', 'vy'],
    ['r', 'vr'],
    ['s', 'vs'],
  ] as const
  for (let i = 0; i < steps; i++) {
    for (const [pos, vel] of axes) {
      const [value, velocity] = springAxis(body[pos], body[vel], target[pos], spring, h)
      body[pos] = value
      body[vel] = velocity
    }
  }
}

function isSettled(body: Body, target: Pose) {
  return (
    Math.abs(body.x - target.x) < 0.1 &&
    Math.abs(body.y - target.y) < 0.1 &&
    Math.abs(body.r - target.r) < 0.02 &&
    Math.abs(body.s - target.s) < 0.0005 &&
    Math.abs(body.vx) + Math.abs(body.vy) < 2 &&
    Math.abs(body.vr) < 1 &&
    Math.abs(body.vs) < 0.01
  )
}

/** Distance along (ux, uy) at which a w×h card no longer covers the deck. */
function clearance(w: number, h: number, ux: number, uy: number) {
  const along = Math.min(ux === 0 ? Number.POSITIVE_INFINITY : w / Math.abs(ux), uy === 0 ? Number.POSITIVE_INFINITY : h / Math.abs(uy))
  return along + 24
}

function releaseVelocity(samples: Drag['samples']) {
  const last = samples.at(-1)
  const first = samples.find((sample) => last && last.t - sample.t <= VELOCITY_WINDOW)
  if (!(first && last) || last.t - first.t < 8) return { vx: 0, vy: 0 }
  const dt = last.t - first.t
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
}

function cardState(phase: Phase) {
  if (phase === 'drag') return 'drag'
  return phase === 'rest' ? 'rest' : 'fly'
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function CardStack({
  items,
  onOpen,
  label = 'Card deck. Drag a card away or use the arrow keys to cycle.',
  className,
}: {
  items: StackItem[]
  /** Called when the top card is tapped or activated with Enter/Space. */
  onOpen?: (item: StackItem) => void
  label?: string
  className?: string
}) {
  const count = items.length
  const [order, setOrder] = useState(() => items.map((_, i) => i))

  const orderRef = useRef(order)
  const bodies = useRef<Body[]>(items.map((_, i) => makeBody(i)))
  const nodes = useRef<(HTMLButtonElement | null)[]>([])
  const drag = useRef<Drag | null>(null)
  // 0–1: how close the current drag is to a throw. The card beneath rises to meet it.
  const progress = useRef(0)
  const raf = useRef(0)
  const last = useRef(0)
  const suppressClick = useRef(false)
  const focusTop = useRef(false)

  const write = useCallback((index: number, depth: number) => {
    const node = nodes.current[index]
    const body = bodies.current[index]
    if (!(node && body)) return
    node.style.transform = poseTransform(body)
    node.style.zIndex = String(body.z ?? orderRef.current.length - depth)
    const state = cardState(body.phase)
    if (node.dataset.state !== state) node.dataset.state = state
  }, [])

  const targetFor = useCallback((body: Body, depth: number): Pose => {
    if (body.phase === 'out') return body.out
    const pose = slotPose(depth)
    if (depth > 0 && progress.current > 0) return lerpPose(pose, slotPose(depth - 1), progress.current * 0.6)
    return pose
  }, [])

  const advance = useCallback(
    (index: number, depth: number, dt: number) => {
      const body = bodies.current[index]
      if (!body) return false
      if (body.phase === 'drag') {
        write(index, depth)
        return true
      }
      const reduced = prefersReducedMotion()
      if (reduced && body.phase === 'out') {
        body.phase = 'rest'
        body.z = null
      }
      const target = targetFor(body, depth)
      if (reduced) Object.assign(body, target, { vx: 0, vy: 0, vr: 0, vs: 0 })
      else stepBody(body, target, dt)
      // Top of the arc: the card stops travelling outward, swaps to its new layer while clear of the deck, and heads home.
      if (body.phase === 'out' && body.vx * body.dx + body.vy * body.dy <= 0) {
        body.phase = 'return'
        body.z = body.apexZ
      }
      const settled = isSettled(body, target)
      if (settled && body.phase !== 'out') {
        body.phase = 'rest'
        body.z = null
      }
      write(index, depth)
      return !settled
    },
    [targetFor, write],
  )

  const tick = useCallback(
    (now: number) => {
      const dt = Math.min((now - last.current) / 1000, 1 / 30)
      last.current = now
      let active = false
      orderRef.current.forEach((index, depth) => {
        if (advance(index, depth, dt)) active = true
      })
      raf.current = active ? requestAnimationFrame(tick) : 0
    },
    [advance],
  )

  // The loop sleeps whenever every card has settled; anything that moves a card wakes it.
  const kick = useCallback(() => {
    if (raf.current) return
    last.current = performance.now()
    raf.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current)
    }
  }, [])

  // A new set of cards (a different count) starts a fresh, squared-up pile.
  useEffect(() => {
    if (orderRef.current.length === count) return
    const next = Array.from({ length: count }, (_, i) => i)
    bodies.current = next.map((i) => makeBody(i))
    orderRef.current = next
    setOrder(next)
    kick()
  }, [count, kick])

  const commitOrder = useCallback(
    (next: number[]) => {
      orderRef.current = next
      setOrder(next)
      kick()
    },
    [kick],
  )

  // Send the top card flying along (vx, vy) px/ms; it comes back under the pile. (fx, fy) is the fallback direction.
  const throwTop = useCallback(
    (vx: number, vy: number, fx: number, fy: number) => {
      const current = orderRef.current
      const index = current[0]
      if (index === undefined || current.length < 2) return
      const body = bodies.current[index]
      const node = nodes.current[index]
      if (!body) return
      const speed = Math.hypot(vx, vy)
      const rawX = speed > 0.05 ? vx : fx
      const rawY = speed > 0.05 ? vy : fy
      const norm = Math.hypot(rawX, rawY) || 1
      const ux = rawX / norm
      const uy = rawY / norm
      const w = node?.offsetWidth ?? 256
      const h = node?.offsetHeight ?? 320
      const distance = clearance(w, h, ux, uy) + Math.min(speed * 50, 90)
      // Keep some speed so a slow but far drag still leaves with intent.
      const launch = Math.max(speed, 0.9) * 1000
      body.phase = 'out'
      body.dx = ux
      body.dy = uy
      body.out = { x: ux * distance, y: uy * distance, r: Math.max(-40, Math.min(40, body.r + ux * 26)), s: 1 }
      body.vx = ux * launch
      body.vy = uy * launch
      body.vr += ux * launch * 0.05
      body.z = TOP_Z
      body.apexZ = null
      commitOrder([...current.slice(1), index])
    },
    [commitOrder],
  )

  // The bottom card slips out to the left, swaps on top at its apex and lands as the new top card.
  const bringBack = useCallback(() => {
    const current = orderRef.current
    const index = current.at(-1)
    if (index === undefined || current.length < 2) return
    const body = bodies.current[index]
    const node = nodes.current[index]
    if (!body) return
    const ux = -0.97
    const uy = -0.24
    const w = node?.offsetWidth ?? 256
    const h = node?.offsetHeight ?? 320
    const distance = clearance(w, h, ux, uy) + 20
    body.phase = 'out'
    body.dx = ux
    body.dy = uy
    body.out = { x: ux * distance, y: uy * distance, r: -16, s: 1 }
    body.vx = ux * 1100
    body.vy = uy * 1100
    body.z = 0
    body.apexZ = TOP_Z - 1
    commitOrder([index, ...current.slice(0, -1)])
  }, [commitOrder])

  const cycle = useCallback(
    (direction: 1 | -1) => {
      if (direction === 1) throwTop(1.3, -0.35, 1, 0)
      else bringBack()
    },
    [throwTop, bringBack],
  )

  // Keep keyboard focus on whichever card is now on top.
  useEffect(() => {
    if (!focusTop.current) return
    focusTop.current = false
    const topCard = order[0]
    if (topCard !== undefined) nodes.current[topCard]?.focus({ preventScroll: true })
  }, [order])

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    suppressClick.current = false
    if (drag.current || orderRef.current[0] !== index) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const body = bodies.current[index]
    if (!body) return
    const node = event.currentTarget
    const rect = node.getBoundingClientRect()
    node.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      startY: event.clientY,
      baseX: body.x,
      baseY: body.y,
      width: node.offsetWidth,
      lever: event.clientY - rect.top < rect.height / 2 ? 1 : -1,
      moved: false,
      samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.moved) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return
      // Axis lock for touch: a mostly vertical swipe is a page scroll, so let go of the card (touch-action: pan-y).
      if (event.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        return
      }
    }
    const body = bodies.current[current.index]
    if (!body) return
    current.moved = true
    current.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY })
    if (current.samples.length > 24) current.samples.shift()
    body.phase = 'drag'
    body.x = current.baseX + dx
    body.y = current.baseY + dy
    body.s = 1
    // Pivot at the bottom edge: grabbing the top half swings the top out, the bottom half the other way.
    body.r = Math.max(-1, Math.min(1, body.x / current.width)) * MAX_DRAG_ROTATION * current.lever
    body.vx = 0
    body.vy = 0
    body.vr = 0
    body.vs = 0
    progress.current = Math.min(Math.hypot(body.x, body.y) / (current.width * THROW_DISTANCE), 1)
    kick()
  }

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    progress.current = 0
    const body = bodies.current[current.index]
    if (!(body && current.moved)) {
      kick()
      return
    }
    if (cancelled) {
      // The browser took the gesture (or capture was lost): no throw, no click, just spring home.
      body.phase = 'rest'
      kick()
      return
    }
    suppressClick.current = true
    const { vx, vy } = releaseVelocity(current.samples)
    const speed = Math.hypot(vx, vy)
    const distance = Math.hypot(body.x, body.y)
    // A flick back toward the deck is a change of mind, not a throw.
    const heading = distance > 0 ? (vx * body.x + vy * body.y) / distance : 0
    const fast = speed > THROW_VELOCITY && heading > -0.2
    const far = distance > current.width * THROW_DISTANCE && heading > -0.3
    if (fast || far) {
      throwTop(vx, vy, body.x / (distance || 1), body.y / (distance || 1))
      return
    }
    // Spring home, carrying the release velocity into the spring.
    body.phase = 'rest'
    body.vx = vx * 1000
    body.vy = vy * 1000
    body.vr = ((vx * 1000) / current.width) * MAX_DRAG_ROTATION * current.lever
    kick()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // A drag that ended without its click must not swallow Enter or Space.
    suppressClick.current = false
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTop.current = true
      cycle(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTop.current = true
      cycle(-1)
    }
  }

  const topIndex = order[0] ?? 0
  const top = items[topIndex]

  return (
    <div className={cx('cstack', className)}>
      <section aria-label={label} className="cstack-deck">
        {items.map((item, index) => {
          const depth = order.indexOf(index)
          const isTop = depth === 0
          return (
            <button
              aria-label={item.label}
              className={cx('cstack-card', isTop && 'is-top')}
              data-state="rest"
              // Cards under the top one are unreachable. React 18's types lack `inert`, so pass it as a plain attribute.
              {...(isTop ? {} : ({ inert: '' } as Record<string, string>))}
              key={item.id}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                if (orderRef.current[0] === index) onOpen?.(item)
              }}
              onKeyDown={handleKeyDown}
              onLostPointerCapture={(event) => handlePointerUp(event, true)}
              onPointerCancel={(event) => handlePointerUp(event, true)}
              onPointerDown={(event) => handlePointerDown(event, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => handlePointerUp(event)}
              ref={(node) => {
                nodes.current[index] = node
              }}
              style={{ transform: poseTransform(slotPose(index)), zIndex: count - index }}
              tabIndex={isTop ? 0 : -1}
              type="button"
            >
              <span className="cstack-face">{item.content}</span>
            </button>
          )
        })}
      </section>

      {count > 1 && (
        <div className="cstack-nav">
          <button aria-label="Previous card" className="cstack-nav-btn" onClick={() => cycle(-1)} type="button">
            <ChevronLeft aria-hidden />
          </button>
          <p aria-live="polite" className="cstack-count">
            <span className="cstack-count-now">{String(topIndex + 1).padStart(2, '0')}</span>
            {' / '}
            {String(count).padStart(2, '0')}
            <span className="sr-only">: {top?.label}</span>
          </p>
          <button aria-label="Next card" className="cstack-nav-btn" onClick={() => cycle(1)} type="button">
            <ChevronRight aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
