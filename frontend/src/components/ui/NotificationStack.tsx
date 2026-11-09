/**
 * Notification Stack, ported from KokonutUI (Tailwind) to this app's CSS, and used for the app's toasts.
 *
 * Original: "Notification Stack" v1.1.0 by @dorianbaffier, https://kokonutui.com/docs/cards/notification-stack
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: items are controlled by the parent and new ones can arrive at any time (the original
 * only removed cards), so every card is measured as it mounts; each card can time out on its own, paused while the
 * stack is hovered or focused, and leaves with the same flight as a swipe; a "Clear" control; CSS classes and tokens.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cx } from '../../lib/cx'

export interface StackNotification {
  id: string
  title: string
  body?: string
  /** Shown top-right, e.g. "now". */
  time: string
  icon?: ReactNode
  /** Auto-dismiss after this many ms (paused while the stack is hovered or focused). Omit to keep it. */
  duration?: number
}

// Collapsed: how much of each card behind the front one peeks out.
const PEEK = 10
const VISIBLE_BEHIND = 2
const GAP = 8
const FALLBACK_HEIGHT = 64
// A swipe dismisses when it travels this far, or when it is a quick flick (px per ms).
const DISMISS_DISTANCE = 100
const DISMISS_VELOCITY = 0.11
// Movement before we decide whether the gesture is a horizontal swipe or a vertical scroll.
const AXIS_LOCK = 6
// Snap-back spring (critically damped).
const SPRING_STIFFNESS = 520
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS)
// Dismiss flight: a released card keeps its own speed (px/s), never slower than this, and speeds up as it goes.
const FLIGHT_MIN_SPEED = 1400
const FLIGHT_ACCEL = 4200
const VELOCITY_WINDOW_MS = 80
const EXIT_MS = 200
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

interface Drag {
  pointerId: number
  startX: number
  startY: number
  /** Where the card already was when grabbed (mid snap-back). */
  originX: number
  dx: number
  axis: 'x' | 'y' | null
  samples: { t: number; x: number }[]
}

const opacityFor = (x: number) => Math.max(1 - Math.abs(x) / 240, 0.3)

/** Release velocity in px/ms from the most recent pointer samples. */
function releaseVelocity(samples: { t: number; x: number }[]) {
  const last = samples[samples.length - 1]
  if (!last) return 0
  let first = last
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]
    if (last.t - sample.t > VELOCITY_WINDOW_MS) break
    first = sample
  }
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}

/** Which way a released card leaves, or 0 to spring back. A flick counts only when it moves away from rest. */
function dismissDirection(dx: number, velocity: number): 1 | -1 | 0 {
  const flick = Math.abs(velocity) > DISMISS_VELOCITY && Math.sign(velocity) === Math.sign(dx)
  if (Math.abs(dx) < DISMISS_DISTANCE && !flick) return 0
  return (dx === 0 ? velocity : dx) > 0 ? 1 : -1
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function NotificationStack({
  items,
  onDismiss,
  className,
}: {
  /** Newest first. */
  items: StackNotification[]
  /** Called once a card has finished leaving; remove it from `items` then. */
  onDismiss: (id: string) => void
  className?: string
}) {
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set())

  const listRef = useRef<HTMLOListElement>(null)
  const swipeRefs = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const timers = useRef<number[]>([])
  const lastY = useRef(new Map<string, number>())
  const swipeX = useRef(new Map<string, number>())
  const frames = useRef(new Map<string, number>())
  const dismissed = useRef(new Set<string>())
  const stopListening = useRef<(() => void) | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  // Auto-dismiss: time left per card, counted down only while the stack is idle.
  const remaining = useRef(new Map<string, number>())

  useEffect(() => {
    const pending = timers.current
    const running = frames.current
    return () => {
      for (const id of pending) window.clearTimeout(id)
      for (const frame of running.values()) cancelAnimationFrame(frame)
      stopListening.current?.()
      observer.current?.disconnect()
    }
  }, [])

  // Measure each card as it mounts and whenever it resizes (text rewrapping).
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = (entries: { id?: string; height: number }[]) => {
      setHeights((prev) => {
        let next = prev
        for (const { id, height } of entries) {
          if (id && height && prev[id] !== height) {
            next = next === prev ? { ...prev } : next
            next[id] = height
          }
        }
        return next
      })
    }
    if (!observer.current) {
      observer.current = new ResizeObserver((entries) => {
        measure(entries.map((entry) => ({ id: (entry.target as HTMLElement).dataset.id, height: Math.round(entry.borderBoxSize[0]?.blockSize ?? 0) })))
      })
    }
    const cards = Array.from(list.children) as HTMLElement[]
    measure(cards.map((card) => ({ id: card.dataset.id, height: card.offsetHeight })))
    for (const card of cards) observer.current.observe(card)
  }, [items])

  const laidOut = items.filter((item) => !leaving.has(item.id))
  const expanded = (hovered || focused || pinned) && laidOut.length > 1
  const heightOf = (id: string) => heights[id] ?? FALLBACK_HEIGHT

  const frontHeight = laidOut[0] ? heightOf(laidOut[0].id) : 0
  const stackHeight = expanded
    ? laidOut.reduce((sum, item) => sum + heightOf(item.id), 0) + Math.max(laidOut.length - 1, 0) * GAP
    : frontHeight + Math.min(Math.max(laidOut.length - 1, 0), VISIBLE_BEHIND) * PEEK

  const offsets: number[] = []
  let runningY = 0
  for (const item of laidOut) {
    offsets.push(runningY)
    runningY += heightOf(item.id) + GAP
  }

  const stopFrame = (id: string) => {
    const frame = frames.current.get(id)
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frames.current.delete(id)
    }
  }

  const paint = (id: string, x: number) => {
    swipeX.current.set(id, x)
    const node = swipeRefs.current.get(id)
    if (node) {
      node.style.transition = 'none'
      node.style.transform = x === 0 ? '' : `translateX(${x}px)`
      node.style.opacity = x === 0 ? '' : `${opacityFor(x)}`
    }
  }

  /** Step a per-card simulation on rAF until it reports it is done. */
  const run = (id: string, step: (dt: number) => boolean, onDone?: () => void) => {
    stopFrame(id)
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      if (step(dt)) {
        frames.current.delete(id)
        onDone?.()
        return
      }
      frames.current.set(id, requestAnimationFrame(tick))
    }
    frames.current.set(id, requestAnimationFrame(tick))
  }

  /** Spring back to rest, starting with the speed the finger let go at. */
  const snapBack = (id: string, velocity: number) => {
    let x = swipeX.current.get(id) ?? 0
    let v = velocity * 1000
    if (prefersReducedMotion()) {
      paint(id, 0)
      return
    }
    run(id, (dt) => {
      const force = -SPRING_STIFFNESS * x - SPRING_DAMPING * v
      v += force * dt
      x += v * dt
      if (Math.abs(x) < 0.5 && Math.abs(v) < 10) {
        paint(id, 0)
        return true
      }
      paint(id, x)
      return false
    })
  }

  const finishDismiss = (id: string) => {
    lastY.current.delete(id)
    swipeX.current.delete(id)
    remaining.current.delete(id)
    dismissed.current.delete(id)
    setLeaving((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    onDismiss(id)
  }

  /** Throw the card off the side, keeping a swipe's release speed. */
  const dismiss = (id: string, direction: 1 | -1, velocity = 0) => {
    if (dismissed.current.has(id)) return
    dismissed.current.add(id)
    setLeaving((prev) => new Set(prev).add(id))
    const node = swipeRefs.current.get(id)

    // Keep focus in the stack when the focused card leaves.
    if (node?.contains(document.activeElement)) {
      const at = laidOut.findIndex((item) => item.id === id)
      const next = laidOut[at + 1] ?? laidOut[at - 1]
      const target = next ? swipeRefs.current.get(next.id)?.querySelector('article') : listRef.current
      target?.focus()
    }

    if (!node || prefersReducedMotion()) {
      stopFrame(id)
      if (node) {
        node.style.transition = `opacity ${EXIT_MS}ms ${EASE_OUT}`
        node.style.opacity = '0'
      }
      timers.current.push(window.setTimeout(() => finishDismiss(id), EXIT_MS))
      return
    }

    const distance = node.offsetWidth * 1.1
    let x = swipeX.current.get(id) ?? 0
    let speed = Math.max(Math.abs(velocity) * 1000, FLIGHT_MIN_SPEED)
    run(
      id,
      (dt) => {
        speed += FLIGHT_ACCEL * dt
        x += direction * speed * dt
        const done = Math.abs(x) >= distance
        paint(id, done ? direction * distance : x)
        node.style.opacity = `${Math.max(1 - Math.abs(x) / distance, 0)}`
        return done
      },
      () => finishDismiss(id),
    )
  }

  // Auto-dismiss: count each card's time down while nobody is looking at the stack.
  const busy = hovered || focused || pinned
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss
  useEffect(() => {
    for (const item of items) if (item.duration && !remaining.current.has(item.id)) remaining.current.set(item.id, item.duration)
    if (busy) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const elapsed = now - last
      last = now
      for (const [key, left] of remaining.current) {
        const next = left - elapsed
        if (next <= 0) {
          remaining.current.delete(key)
          dismissRef.current(key, 1)
        } else {
          remaining.current.set(key, next)
        }
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [items, busy])

  // Collapse once only one card is left.
  useEffect(() => {
    if (laidOut.length <= 1 && pinned) setPinned(false)
  }, [laidOut.length, pinned])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, index: number, id: string) => {
    // Only the front card can be swiped while collapsed, and a second finger never takes over a running drag.
    if (drag.current || leaving.has(id) || (!expanded && index > 0)) return
    suppressClick.current = false
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    stopFrame(id)
    const { pointerId } = event
    const release = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== pointerId) return
      stopListening.current?.()
      if (drag.current?.pointerId === pointerId) {
        drag.current = null
        if (swipeX.current.get(id)) snapBack(id, 0)
      }
    }
    stopListening.current?.()
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    stopListening.current = () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      stopListening.current = null
    }
    drag.current = { pointerId, startX: event.clientX, startY: event.clientY, originX: swipeX.current.get(id) ?? 0, dx: 0, axis: null, samples: [] }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>, id: string) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (current.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (current.axis !== 'x') return
    current.dx = current.originX + dx
    current.samples.push({ t: event.timeStamp, x: current.dx })
    if (current.samples.length > 12) current.samples.shift()
    paint(id, current.dx)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>, id: string) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    if (current.axis !== 'x') {
      if (swipeX.current.get(id)) snapBack(id, 0)
      return
    }
    suppressClick.current = true
    const velocity = releaseVelocity(current.samples)
    const direction = dismissDirection(current.dx, velocity)
    if (direction === 0) {
      snapBack(id, velocity)
      return
    }
    dismiss(id, direction, Math.sign(velocity) === direction ? velocity : 0)
  }

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (event.repeat) return
      dismiss(id, 1)
    }
  }

  if (items.length === 0) return null

  return (
    <div
      className={cx('nstack', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false)
      }}
      onFocus={() => setFocused(true)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovered(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHovered(false)
      }}
    >
      {laidOut.length > 1 && (
        <div className="nstack-head">
          <p className="nstack-count">
            Notifications <span>{laidOut.length}</span>
          </p>
          <span className="nstack-actions">
            <button aria-expanded={expanded} className="nstack-link" onClick={() => setPinned((prev) => !prev)} type="button">
              {expanded ? 'Show less' : 'Show all'}
            </button>
            <button className="nstack-link" onClick={() => laidOut.forEach((item, i) => timers.current.push(window.setTimeout(() => dismiss(item.id, 1), i * 60)))} type="button">
              Clear
            </button>
          </span>
        </div>
      )}

      <ol aria-label="Notifications" aria-live="polite" className="nstack-list" ref={listRef} style={{ height: stackHeight }} tabIndex={-1}>
        {items.map((item) => {
          const index = laidOut.findIndex((card) => card.id === item.id)
          const isLeaving = index === -1
          const depth = Math.max(index, 0)
          const hiddenBehind = !(expanded || depth <= VISIBLE_BEHIND)
          const scale = expanded || isLeaving ? 1 : 1 - depth * 0.05
          // Bottom-align the cards behind so a strip of each peeks out below the front card.
          const restingY = expanded ? offsets[depth] : frontHeight + depth * PEEK - heightOf(item.id) * scale
          const y = isLeaving ? (lastY.current.get(item.id) ?? 0) : restingY
          if (!isLeaving) lastY.current.set(item.id, restingY)
          const muted = !expanded && depth > 0

          return (
            <li
              className="nstack-item"
              data-id={item.id}
              key={item.id}
              style={{
                transform: `translateY(${y}px) scale(${scale})`,
                opacity: hiddenBehind ? 0 : 1,
                zIndex: items.length - depth,
                pointerEvents: hiddenBehind ? 'none' : undefined,
              }}
            >
              <div
                className="nstack-swipe"
                onLostPointerCapture={(event) => {
                  if (event.target === event.currentTarget) handlePointerUp(event, item.id)
                }}
                onPointerCancel={(event) => handlePointerUp(event, item.id)}
                onPointerDown={(event) => handlePointerDown(event, depth, item.id)}
                onPointerMove={(event) => handlePointerMove(event, item.id)}
                onPointerUp={(event) => handlePointerUp(event, item.id)}
                ref={(node) => {
                  if (node) swipeRefs.current.set(item.id, node)
                  else swipeRefs.current.delete(item.id)
                }}
              >
                <article
                  aria-label={`${item.title}${item.body ? `. ${item.body}` : ''}`}
                  className={cx('nstack-card', !expanded && depth === 0 && laidOut.length > 1 && 'is-openable')}
                  onClick={() => {
                    if (suppressClick.current) {
                      suppressClick.current = false
                      return
                    }
                    if (!expanded && laidOut.length > 1) setPinned(true)
                  }}
                  onKeyDown={(event) => handleCardKeyDown(event, item.id)}
                  tabIndex={hiddenBehind ? -1 : 0}
                >
                  <div className={cx('nstack-content', muted && 'is-muted')}>
                    {item.icon && <div className="nstack-icon">{item.icon}</div>}
                    <div className="nstack-text">
                      <div className="nstack-title-row">
                        <p className="nstack-title">{item.title}</p>
                        <span className="nstack-time">{item.time}</span>
                      </div>
                      {item.body && <p className="nstack-body">{item.body}</p>}
                    </div>
                  </div>
                  <button
                    aria-label={`Dismiss ${item.title}`}
                    className={cx('nstack-close', muted && 'is-hidden')}
                    onClick={(event) => {
                      event.stopPropagation()
                      dismiss(item.id, 1)
                    }}
                    tabIndex={hiddenBehind ? -1 : 0}
                    type="button"
                  >
                    <X aria-hidden />
                  </button>
                </article>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
