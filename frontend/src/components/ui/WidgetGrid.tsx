/**
 * Widget grid (bento layout), ported from KokonutUI's Widget Grid ("bento-grid", Tailwind + motion) to this app's CSS.
 *
 * Original: "Widget Grid" v3.0.0 by @dorianbaffier, https://kokonutui.com/docs/cards/bento-grid
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original:
 * - Widgets can be taller than one row (`rows`), carry a description and header actions, and scroll inside when
 *   their content is longer than the tile. The demo widgets are left out.
 * - On narrow containers every widget takes the full width (the app's lists don't fit a half-width phone column),
 *   so resizing is only offered on the 6-column layout. Reordering works everywhere.
 * - Other widgets dim only while one is held or resized, not on plain hover, since this is a dashboard people read.
 * - Widgets hold links and buttons: a press that starts on a control never lifts the tile, the click that ends a
 *   drag is swallowed so dropping a tile doesn't follow a link, and native link dragging is turned off.
 * - Styling uses CSS classes and design tokens; the container breakpoint is set from JS.
 * The spring engine, FLIP reflow, long press, keyboard moves and screen reader announcements are unchanged.
 */
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { GripVertical } from 'lucide-react'
import { cx } from '../../lib/cx'

/* ---------------------------------------------------------------- types */

export type WidgetSize = 's' | 'm' | 'l'

export interface WidgetGridItem {
  id: string
  title: string
  description?: string
  icon?: ReactNode
  /** Colour of the icon tile: a tone class from kokonut.css, such as 'tone-blue'. */
  tone?: string
  /** Header controls, such as a link to the full page. */
  actions?: ReactNode
  /** Renders the widget body for the size its column span maps to. */
  render: (size: WidgetSize) => ReactNode
  /** Span used when no layout is given. Defaults to 2. */
  defaultSpan?: number
  /** Height in grid rows. Defaults to 1. */
  rows?: number
}

export interface WidgetLayoutItem {
  id: string
  /** Width in columns of the 6-column grid (2 to 6). */
  span: number
}

export interface WidgetGridProps {
  items: WidgetGridItem[]
  /** Controlled order and spans. */
  layout?: WidgetLayoutItem[]
  /** Uncontrolled starting order and spans. */
  defaultLayout?: WidgetLayoutItem[]
  /** Called on every reorder or resize, including live moves while dragging. */
  onLayoutChange?: (layout: WidgetLayoutItem[]) => void
  className?: string
  /** Height of one row in pixels. */
  rowHeight?: number
  /** Accessible name for the grid. */
  label: string
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface DragState {
  id: string
  mode: 'pointer' | 'keyboard'
  /** The pointer holding the cell; other fingers are ignored. */
  pointerId: number
  grabX: number
  grabY: number
  lastX: number
  lastY: number
  lastT: number
  skipId: string | null
  snapshot: WidgetLayoutItem[]
}

interface PressState {
  id: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  timer: number
}

/* ---------------------------------------------------------------- constants */

const COLUMNS = 6
const MIN_SPAN = 2
const GAP = 16
/** Below this container width the grid is one column. */
const NARROW_BELOW = 720
const LONG_PRESS_MS = 350
const PRESS_SLOP = 8
const LIFT_Z = 18
const MAX_TILT = 7
const SIZE_LABEL: Record<WidgetSize, string> = { s: 'small', m: 'medium', l: 'large' }
/** A press that starts on one of these is the control's, never a lift. */
const NO_PRESS = '[data-no-press], button, input, select, textarea, [role="slider"]'

/** Maps a column span to the widget layout it shows. */
function sizeForSpan(span: number, narrow = false): WidgetSize {
  if (narrow) return 'm'
  if (span <= 2) return 's'
  return span <= 4 ? 'm' : 'l'
}

function clampSpan(span: number) {
  return Math.min(COLUMNS, Math.max(MIN_SPAN, Math.round(span)))
}

function normalizeLayout(layout: WidgetLayoutItem[], items: WidgetGridItem[]): WidgetLayoutItem[] {
  const known = new Set(items.map((item) => item.id))
  const seen = new Set<string>()
  const out: WidgetLayoutItem[] = []
  for (const entry of layout) {
    if (known.has(entry.id) && !seen.has(entry.id)) {
      seen.add(entry.id)
      out.push({ id: entry.id, span: clampSpan(entry.span) })
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) out.push({ id: item.id, span: clampSpan(item.defaultSpan ?? MIN_SPAN) })
  }
  return out
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function contains(rect: Rect, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/** Eats the click a finished drag would otherwise deliver to whatever link sits under the pointer. */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
}

/** While a tile is held, dragging must not select text across the page. */
const blockSelection = (e: Event) => e.preventDefault()

/* ---------------------------------------------------------------- spring physics */

interface SpringConfig {
  k: number
  c: number
}

const spring = (k: number, zeta: number): SpringConfig => ({ k, c: 2 * Math.sqrt(k) * zeta })

const MOVE_SPRING = spring(420, 0.76)
const LIFT_SPRING = spring(520, 0.82)
const TILT_SPRING = spring(260, 0.6)
const STEP = 1 / 120

interface Body {
  ox: number
  oy: number
  vx: number
  vy: number
  sx: number
  sy: number
  vsx: number
  vsy: number
  lift: number
  vlift: number
  liftTarget: number
  rx: number
  ry: number
  vrx: number
  vry: number
  /** Smoothed pointer velocity (px/ms) while pinned to the pointer. */
  pvx: number
  pvy: number
  /** Seconds to wait before springing home (distance stagger). */
  hold: number
  /** Follows the pointer directly instead of springing home. */
  pinned: boolean
}

function createBody(): Body {
  return {
    ox: 0,
    oy: 0,
    vx: 0,
    vy: 0,
    sx: 1,
    sy: 1,
    vsx: 0,
    vsy: 0,
    lift: 0,
    vlift: 0,
    liftTarget: 0,
    rx: 0,
    ry: 0,
    vrx: 0,
    vry: 0,
    pvx: 0,
    pvy: 0,
    hold: 0,
    pinned: false,
  }
}

type NumKey = { [K in keyof Body]: Body[K] extends number ? K : never }[keyof Body]

/** One semi-implicit Euler step of `b[x]` (velocity `b[v]`) toward `target`. */
function integrate(b: Body, x: NumKey, v: NumKey, target: number, cfg: SpringConfig, dt: number) {
  const a = -cfg.k * (b[x] - target) - cfg.c * b[v]
  b[v] += a * dt
  b[x] += b[v] * dt
}

const clampTilt = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v))

function stepBody(b: Body, dt: number) {
  // Lean toward the drag direction: right edge dips when moving right.
  const tiltY = b.pinned ? clampTilt(b.pvx * 9) : 0
  const tiltX = b.pinned ? clampTilt(-b.pvy * 9) : 0
  integrate(b, 'ry', 'vry', tiltY, TILT_SPRING, dt)
  integrate(b, 'rx', 'vrx', tiltX, TILT_SPRING, dt)
  integrate(b, 'lift', 'vlift', b.liftTarget, LIFT_SPRING, dt)
  // Pointer velocity decays when the pointer rests, so the tilt settles.
  b.pvx *= Math.exp(-dt * 10)
  b.pvy *= Math.exp(-dt * 10)
  if (b.hold > 0) {
    b.hold -= dt
    return
  }
  if (!b.pinned) {
    integrate(b, 'ox', 'vx', 0, MOVE_SPRING, dt)
    integrate(b, 'oy', 'vy', 0, MOVE_SPRING, dt)
  }
  integrate(b, 'sx', 'vsx', 1, MOVE_SPRING, dt)
  integrate(b, 'sy', 'vsy', 1, MOVE_SPRING, dt)
}

const near = (x: number, v: number, target: number, eps: number) => Math.abs(x - target) < eps && Math.abs(v) < eps * 10

function isSettled(b: Body) {
  if (b.pinned || b.hold > 0) return false
  return (
    near(b.ox, b.vx, 0, 0.2) &&
    near(b.oy, b.vy, 0, 0.2) &&
    near(b.sx, b.vsx, 1, 0.001) &&
    near(b.sy, b.vsy, 1, 0.001) &&
    near(b.lift, b.vlift, b.liftTarget, 0.002) &&
    near(b.rx, b.vrx, 0, 0.02) &&
    near(b.ry, b.vry, 0, 0.02)
  )
}

function snapBody(b: Body) {
  if (!b.pinned) {
    b.ox = 0
    b.oy = 0
  }
  b.vx = 0
  b.vy = 0
  b.sx = 1
  b.sy = 1
  b.vsx = 0
  b.vsy = 0
  b.lift = b.liftTarget
  b.vlift = 0
  b.rx = 0
  b.ry = 0
  b.vrx = 0
  b.vry = 0
  b.hold = 0
}

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Owns every cell's spring state and writes transforms straight to the DOM,
 * so React never re-renders per frame. The loop sleeps once all is settled.
 */
class GridEngine {
  bodies = new Map<string, Body>()
  els = new Map<string, HTMLElement>()
  reduced = false
  private raf = 0
  private last = 0

  body(id: string) {
    let b = this.bodies.get(id)
    if (!b) {
      b = createBody()
      this.bodies.set(id, b)
    }
    return b
  }

  kick() {
    if (this.raf || typeof window === 'undefined') return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  write(id: string, b: Body) {
    const el = this.els.get(id)
    if (!el) return
    const surface = el.firstElementChild as HTMLElement | null
    const shadow = surface?.firstElementChild as HTMLElement | null
    const atRest = b.ox === 0 && b.oy === 0 && b.lift === 0 && b.rx === 0 && b.ry === 0
    el.style.transform = atRest
      ? ''
      : `translate3d(${r2(b.ox)}px, ${r2(b.oy)}px, ${r2(b.lift * LIFT_Z)}px) rotateX(${r2(b.rx)}deg) rotateY(${r2(b.ry)}deg)`
    if (surface) surface.style.transform = b.sx === 1 && b.sy === 1 ? '' : `scale(${r3(b.sx)}, ${r3(b.sy)})`
    if (shadow) shadow.style.opacity = String(r2(Math.max(0, Math.min(1, b.lift))))
  }

  private advance(b: Body, elapsed: number) {
    if (this.reduced) {
      snapBody(b)
      return false
    }
    let t = elapsed
    while (t > 0) {
      const dt = Math.min(STEP, t)
      stepBody(b, dt)
      t -= dt
    }
    if (isSettled(b)) {
      snapBody(b)
      return false
    }
    return true
  }

  private readonly tick = (now: number) => {
    const elapsed = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    let active = false
    for (const [id, b] of this.bodies) {
      active = this.advance(b, elapsed) || active
      this.write(id, b)
    }
    this.raf = active ? requestAnimationFrame(this.tick) : 0
  }
}

/* ---------------------------------------------------------------- cell */

interface CellProps {
  item: WidgetGridItem
  span: number
  narrow: boolean
  lifted: boolean
  dimmed: boolean
  instructionsId: string
  cellRef: (el: HTMLDivElement | null) => void
  gripRef: (el: HTMLButtonElement | null) => void
  onPressStart: (e: ReactPointerEvent<HTMLDivElement>) => void
  onGripPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onGripKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  onGripBlur: () => void
  onResizePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
  onResizeKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

function WidgetCell({
  item,
  span,
  narrow,
  lifted,
  dimmed,
  instructionsId,
  cellRef,
  gripRef,
  onPressStart,
  onGripPointerDown,
  onGripKeyDown,
  onGripBlur,
  onResizePointerDown,
  onResizeKeyDown,
}: CellProps) {
  const size = sizeForSpan(span, narrow)
  const titleId = useId()

  // Long-pressing with a finger would otherwise open the system menu.
  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as globalThis.PointerEvent
    if (lifted || native.pointerType === 'touch') e.preventDefault()
  }

  return (
    <div
      aria-labelledby={titleId}
      className={cx('wgrid-cell', dimmed && 'is-dimmed', lifted && 'is-lifted')}
      onContextMenu={handleContextMenu}
      onPointerDown={onPressStart}
      ref={cellRef}
      role="group"
      style={{ '--span': narrow ? 1 : span, '--rows': item.rows ?? 1 } as CSSProperties}
    >
      {/* Surface: scaled by the engine while a resize settles. */}
      <div className="wgrid-surface">
        {/* Lift shadow, faded in by the engine. */}
        <div className="wgrid-shadow" />
      </div>

      <div className="wgrid-inner">
        <header className="wgrid-head">
          {item.icon && (
            <span aria-hidden className={cx('wgrid-icon', item.tone)}>
              {item.icon}
            </span>
          )}
          <span className="wgrid-heading">
            <h2 className="wgrid-title" id={titleId}>
              {item.title}
            </h2>
            {item.description && <span className="wgrid-desc">{item.description}</span>}
          </span>
          {item.actions && (
            <span className="wgrid-actions" data-no-press>
              {item.actions}
            </span>
          )}
          <button
            aria-describedby={instructionsId}
            aria-label={narrow ? `Move ${item.title}` : `Move ${item.title} (${SIZE_LABEL[size]})`}
            aria-pressed={lifted}
            className={cx('wgrid-grip', lifted && 'is-active')}
            data-no-press
            onBlur={onGripBlur}
            onKeyDown={onGripKeyDown}
            onPointerDown={onGripPointerDown}
            ref={gripRef}
            type="button"
          >
            <GripVertical aria-hidden />
          </button>
        </header>

        <div className="wgrid-body">
          <AnimatePresence initial={false}>
            <motion.div
              animate={{ opacity: 1 }}
              className="wgrid-content"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={size}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            >
              {item.render(size)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {!narrow && (
        <button
          aria-label={`Resize ${item.title}, ${span} of ${COLUMNS} columns`}
          className="wgrid-resize"
          data-no-press
          onKeyDown={onResizeKeyDown}
          onPointerDown={onResizePointerDown}
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 10 10">
            <circle cx="8.5" cy="3.5" fill="currentColor" r="1.1" />
            <circle cx="6" cy="6" fill="currentColor" r="1.1" />
            <circle cx="3.5" cy="8.5" fill="currentColor" r="1.1" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- grid */

export function WidgetGrid({ items, layout, defaultLayout, onLayoutChange, className, rowHeight = 200, label }: WidgetGridProps) {
  const instructionsId = useId()
  const [innerLayout, setInnerLayout] = useState<WidgetLayoutItem[]>(() => normalizeLayout(defaultLayout ?? [], items))
  const current = useMemo(() => normalizeLayout(layout ?? innerLayout, items), [layout, innerLayout, items])
  const layoutKey = current.map((c) => `${c.id}:${c.span}`).join('|')
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  const [narrow, setNarrow] = useState(false)
  const [liftedId, setLiftedId] = useState<string | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const wrapRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GridEngine | null>(null)
  if (!engineRef.current) engineRef.current = new GridEngine()
  const engine = engineRef.current
  const rectsRef = useRef(new Map<string, Rect>())
  const gripsRef = useRef(new Map<string, HTMLButtonElement>())
  const pendingFlipRef = useRef<{ prev: Map<string, Rect>; movedId: string } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pressRef = useRef<PressState | null>(null)
  const resizeIdRef = useRef<string | null>(null)
  const resizeStartRef = useRef<{ x: number; span: number } | null>(null)
  const reorderingRef = useRef(false)
  const narrowRef = useRef(false)
  const layoutRef = useRef(current)
  layoutRef.current = current
  const latest = useRef({ layout, onLayoutChange, itemsById })
  latest.current = { layout, onLayoutChange, itemsById }
  // Stable handles to handlers that are declared further down.
  const cancelPressRef = useRef<() => void>(() => undefined)
  const endDragRef = useRef<(cancel: boolean) => void>(() => undefined)

  const titleOf = useCallback((id: string) => latest.current.itemsById.get(id)?.title ?? id, [])

  const announce = useCallback((text: string) => {
    // A trailing space makes a repeated message read again.
    setMessage((prev) => (prev === text ? `${text} ` : text))
  }, [])

  const positionText = useCallback((id: string) => {
    const list = layoutRef.current
    const index = list.findIndex((c) => c.id === id)
    return `position ${index + 1} of ${list.length}`
  }, [])

  const commit = useCallback((next: WidgetLayoutItem[], movedId: string) => {
    pendingFlipRef.current = { prev: new Map(rectsRef.current), movedId }
    layoutRef.current = next
    if (latest.current.layout === undefined) setInnerLayout(next)
    latest.current.onLayoutChange?.(next)
  }, [])

  /* -------------------------------------------- measuring */

  // offset* ignore transforms, so these are the cells' resting slots.
  const measure = useCallback(() => {
    const next = new Map<string, Rect>()
    for (const [id, el] of engine.els) {
      next.set(id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
    }
    rectsRef.current = next
    return next
  }, [engine])

  const toGrid = useCallback((clientX: number, clientY: number) => {
    const box = gridRef.current?.getBoundingClientRect()
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) }
  }, [])

  /** Keeps a pointer-held cell under the pointer, even after its slot moved. */
  const placeDragged = useCallback(() => {
    const drag = dragRef.current
    const rect = drag ? rectsRef.current.get(drag.id) : undefined
    if (!(drag && rect) || drag.mode !== 'pointer') return
    const p = toGrid(drag.lastX, drag.lastY)
    const b = engine.body(drag.id)
    b.ox = p.x - drag.grabX - rect.x
    b.oy = p.y - drag.grabY - rect.y
    engine.write(drag.id, b)
    engine.kick()
  }, [engine, toGrid])

  /** FLIP: start every moved cell where it was drawn, then spring it home. */
  const flip = useCallback(
    (prev: Map<string, Rect>, next: Map<string, Rect>, movedId: string) => {
      const origin = next.get(movedId)
      const cx0 = origin ? origin.x + origin.w / 2 : 0
      const cy0 = origin ? origin.y + origin.h / 2 : 0
      const pinnedId = dragRef.current?.mode === 'pointer' ? dragRef.current.id : null
      for (const [id, n] of next) {
        const p = prev.get(id)
        if (!p || id === pinnedId) continue
        const b = engine.body(id)
        const moved = Math.abs(p.x - n.x) > 0.5 || Math.abs(p.y - n.y) > 0.5 || p.w !== n.w
        b.ox += p.x - n.x
        b.oy += p.y - n.y
        b.sx = (p.w * b.sx) / n.w
        b.sy = (p.h * b.sy) / n.h
        if (moved && id !== movedId) {
          // Nearer neighbours leave first, so the shuffle ripples outward.
          const dist = Math.hypot(n.x + n.w / 2 - cx0, n.y + n.h / 2 - cy0)
          b.hold = Math.min(0.1, dist * 0.00016)
        }
        engine.write(id, b)
      }
      engine.kick()
    },
    [engine],
  )

  // After every layout change: measure, FLIP neighbours, re-seat the held cell.
  useLayoutEffect(() => {
    const next = measure()
    const pending = pendingFlipRef.current
    pendingFlipRef.current = null
    if (pending) flip(pending.prev, next, pending.movedId)
    placeDragged()
    const drag = dragRef.current
    if (drag?.mode === 'keyboard') {
      // React may move the focused node when it reorders; keep focus on it.
      const grip = gripsRef.current.get(drag.id)
      if (grip && document.activeElement !== grip) grip.focus({ preventScroll: true })
    }
    reorderingRef.current = false
  }, [layoutKey, narrow, measure, flip, placeDragged])

  // Container width decides the 1- or 6-column layout (rows grow to fit in one column); re-measure on resize.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const sync = () => {
      const isNarrow = wrap.clientWidth < NARROW_BELOW
      narrowRef.current = isNarrow
      setNarrow(isNarrow)
      measure()
      placeDragged()
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [measure, placeDragged])

  // Reduced motion is read after mount, so it never changes the first render.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      engine.reduced = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [engine])

  /* -------------------------------------------- pointer drag */

  const hitTest = useCallback(
    (x: number, y: number) => {
      const drag = dragRef.current
      if (!drag) return
      // Ignore the cell just swapped with until the pointer leaves it, so cells of different sizes don't flip back and forth.
      if (drag.skipId) {
        const skipRect = rectsRef.current.get(drag.skipId)
        if (skipRect && contains(skipRect, x, y)) return
        drag.skipId = null
      }
      const list = layoutRef.current
      const from = list.findIndex((c) => c.id === drag.id)
      const to = list.findIndex((c) => {
        const rect = rectsRef.current.get(c.id)
        return c.id !== drag.id && rect !== undefined && contains(rect, x, y)
      })
      if (to < 0) return
      drag.skipId = list[to].id
      commit(moveItem(list, from, to), drag.id)
      announce(`${titleOf(drag.id)} moved to position ${to + 1} of ${list.length}.`)
    },
    [announce, commit, titleOf],
  )

  const onDragMove = useCallback(
    (e: globalThis.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.mode !== 'pointer' || e.pointerId !== drag.pointerId) return
      const now = performance.now()
      const dt = Math.max(1, now - drag.lastT)
      const b = engine.body(drag.id)
      b.pvx += ((e.clientX - drag.lastX) / dt - b.pvx) * 0.35
      b.pvy += ((e.clientY - drag.lastY) / dt - b.pvy) * 0.35
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.lastT = now
      placeDragged()
      const p = toGrid(e.clientX, e.clientY)
      hitTest(p.x, p.y)
    },
    [engine, hitTest, placeDragged, toGrid],
  )

  const onDragUp = useCallback((e: globalThis.PointerEvent) => {
    if (e.pointerId === dragRef.current?.pointerId) endDragRef.current(e.type === 'pointercancel')
  }, [])
  const onDragKey = useCallback((e: globalThis.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      endDragRef.current(true)
    }
  }, [])

  const removeDragListeners = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    window.removeEventListener('pointercancel', onDragUp)
    window.removeEventListener('keydown', onDragKey)
    document.removeEventListener('selectstart', blockSelection)
  }, [onDragKey, onDragMove, onDragUp])

  const endDrag = useCallback(
    (cancel: boolean) => {
      const drag = dragRef.current
      if (!drag) return
      removeDragListeners()
      const b = engine.body(drag.id)
      if (drag.mode === 'pointer') {
        // Carry some of the throw into the settle spring.
        b.vx = b.pvx * 400
        b.vy = b.pvy * 400
        swallowNextClick()
      }
      b.pinned = false
      b.liftTarget = 0
      dragRef.current = null
      if (cancel) commit(drag.snapshot, drag.id)
      engine.kick()
      setLiftedId(null)
      const title = titleOf(drag.id)
      if (cancel) {
        const index = drag.snapshot.findIndex((c) => c.id === drag.id)
        announce(`Move cancelled. ${title} returned to position ${index + 1} of ${drag.snapshot.length}.`)
      } else {
        announce(`${title} dropped at ${positionText(drag.id)}.`)
      }
    },
    [announce, commit, engine, positionText, removeDragListeners, titleOf],
  )
  endDragRef.current = endDrag

  const liftPointer = useCallback(
    (id: string, pointerId: number, clientX: number, clientY: number) => {
      const rect = rectsRef.current.get(id)
      if (!rect || dragRef.current) return
      const b = engine.body(id)
      const p = toGrid(clientX, clientY)
      dragRef.current = {
        id,
        mode: 'pointer',
        pointerId,
        grabX: p.x - (rect.x + b.ox),
        grabY: p.y - (rect.y + b.oy),
        lastX: clientX,
        lastY: clientY,
        lastT: performance.now(),
        skipId: null,
        snapshot: layoutRef.current,
      }
      Object.assign(b, { pinned: true, hold: 0, vx: 0, vy: 0, pvx: 0, pvy: 0 })
      b.liftTarget = 1
      engine.kick()
      setLiftedId(id)
      announce(`${titleOf(id)} lifted, ${positionText(id)}.`)
      navigator.vibrate?.(8)
      window.getSelection()?.removeAllRanges()
      document.addEventListener('selectstart', blockSelection)
      window.addEventListener('pointermove', onDragMove)
      window.addEventListener('pointerup', onDragUp)
      window.addEventListener('pointercancel', onDragUp)
      window.addEventListener('keydown', onDragKey)
    },
    [announce, engine, onDragKey, onDragMove, onDragUp, positionText, titleOf, toGrid],
  )

  /* -------------------------------------------- long press */

  const onPressMove = useCallback((e: globalThis.PointerEvent) => {
    const press = pressRef.current
    if (!press || e.pointerId !== press.pointerId) return
    press.x = e.clientX
    press.y = e.clientY
    // Moving first means scrolling (touch) or selecting (mouse), not lifting.
    if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) > PRESS_SLOP) cancelPressRef.current()
  }, [])

  const cancelPress = useCallback(() => {
    const press = pressRef.current
    if (press) window.clearTimeout(press.timer)
    pressRef.current = null
    window.removeEventListener('pointermove', onPressMove)
    window.removeEventListener('pointerup', cancelPressRef.current)
    window.removeEventListener('pointercancel', cancelPressRef.current)
  }, [onPressMove])
  cancelPressRef.current = cancelPress

  const startPress = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      const target = e.target as HTMLElement
      if (dragRef.current || resizeIdRef.current || e.button !== 0 || target.closest(NO_PRESS)) return
      cancelPress()
      pressRef.current = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          const press = pressRef.current
          cancelPressRef.current()
          if (press) liftPointer(press.id, press.pointerId, press.x, press.y)
        }, LONG_PRESS_MS),
      }
      window.addEventListener('pointermove', onPressMove)
      window.addEventListener('pointerup', cancelPress)
      window.addEventListener('pointercancel', cancelPress)
    },
    [cancelPress, liftPointer, onPressMove],
  )

  // A non-passive touchmove listener stops the page scrolling while a cell is held.
  // Until the long press fires, touch scrolling is left alone.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const block = (e: TouchEvent) => {
      if (dragRef.current?.mode === 'pointer' || resizeIdRef.current) e.preventDefault()
    }
    grid.addEventListener('touchmove', block, { passive: false })
    return () => grid.removeEventListener('touchmove', block)
  }, [])

  /* -------------------------------------------- resize */

  const applySpan = useCallback(
    (id: string, span: number) => {
      const list = layoutRef.current
      const entry = list.find((c) => c.id === id)
      if (!entry || entry.span === span) return
      commit(
        list.map((c) => (c.id === id ? { ...c, span } : c)),
        id,
      )
      announce(`${titleOf(id)} resized to ${span} of ${COLUMNS} columns, ${SIZE_LABEL[sizeForSpan(span)]}.`)
    },
    [announce, commit, titleOf],
  )

  /**
   * Whole-column span from how far the handle moved since the press. Using the
   * delta (not the cell's left edge) keeps it stable when the cell wraps rows.
   */
  const spanFromPointer = useCallback((clientX: number) => {
    const start = resizeStartRef.current
    const grid = gridRef.current
    if (!(start && grid)) return null
    const colW = (grid.clientWidth + GAP) / COLUMNS
    return clampSpan(start.span + Math.round((clientX - start.x) / colW))
  }, [])

  const onResizeMove = useCallback(
    (e: globalThis.PointerEvent) => {
      const id = resizeIdRef.current
      const span = spanFromPointer(e.clientX)
      if (id && span !== null) applySpan(id, span)
    },
    [applySpan, spanFromPointer],
  )

  const onResizeUp = useCallback(() => {
    resizeIdRef.current = null
    setResizingId(null)
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeUp)
    window.removeEventListener('pointercancel', onResizeUp)
  }, [onResizeMove])

  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
      if (dragRef.current || e.button !== 0) return
      e.preventDefault()
      cancelPress()
      resizeIdRef.current = id
      resizeStartRef.current = { x: e.clientX, span: layoutRef.current.find((c) => c.id === id)?.span ?? MIN_SPAN }
      setResizingId(id)
      window.addEventListener('pointermove', onResizeMove)
      window.addEventListener('pointerup', onResizeUp)
      window.addEventListener('pointercancel', onResizeUp)
    },
    [cancelPress, onResizeMove, onResizeUp],
  )

  const onResizeKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
      const entry = layoutRef.current.find((c) => c.id === id)
      let delta = 0
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = 1
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -1
      if (!entry || delta === 0) return
      e.preventDefault()
      applySpan(id, clampSpan(entry.span + delta))
    },
    [applySpan],
  )

  /* -------------------------------------------- keyboard */

  /** Index of the closest cell in the row above or below. */
  const verticalNeighbor = useCallback((id: string, up: boolean) => {
    const list = layoutRef.current
    const rects = rectsRef.current
    const cur = rects.get(id)
    let best = -1
    let bestDy = Number.POSITIVE_INFINITY
    let bestDx = Number.POSITIVE_INFINITY
    if (!cur) return best
    const mid = cur.x + cur.w / 2
    for (const [i, c] of list.entries()) {
      const r = rects.get(c.id)
      const inRow = r !== undefined && (up ? r.y + r.h <= cur.y + 1 : r.y >= cur.y + cur.h - 1)
      if (r && inRow) {
        const dy = Math.abs(r.y - cur.y)
        const dx = Math.abs(r.x + r.w / 2 - mid)
        if (dy < bestDy - 1 || (Math.abs(dy - bestDy) <= 1 && dx < bestDx)) {
          best = i
          bestDy = dy
          bestDx = dx
        }
      }
    }
    return best
  }, [])

  const neighborIndex = useCallback(
    (id: string, key: string) => {
      const list = layoutRef.current
      const index = list.findIndex((c) => c.id === id)
      if (key === 'ArrowLeft') return Math.max(0, index - 1)
      if (key === 'ArrowRight') return Math.min(list.length - 1, index + 1)
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const found = verticalNeighbor(id, key === 'ArrowUp')
        return found < 0 ? index : found
      }
      return null
    },
    [verticalNeighbor],
  )

  const liftKeyboard = useCallback(
    (id: string) => {
      dragRef.current = {
        id,
        mode: 'keyboard',
        pointerId: -1,
        grabX: 0,
        grabY: 0,
        lastX: 0,
        lastY: 0,
        lastT: 0,
        skipId: null,
        snapshot: layoutRef.current,
      }
      engine.body(id).liftTarget = 1
      engine.kick()
      setLiftedId(id)
      announce(`${titleOf(id)} lifted, ${positionText(id)}. Arrow keys move it, Space drops it, Escape cancels.`)
    },
    [announce, engine, positionText, titleOf],
  )

  const moveByKey = useCallback(
    (id: string, key: string) => {
      const to = neighborIndex(id, key)
      if (to === null) return false
      const list = layoutRef.current
      const from = list.findIndex((c) => c.id === id)
      if (to === from) {
        announce(`${titleOf(id)} is at ${positionText(id)}.`)
        return true
      }
      reorderingRef.current = true
      commit(moveItem(list, from, to), id)
      announce(`${titleOf(id)} moved to position ${to + 1} of ${list.length}.`)
      return true
    },
    [announce, commit, neighborIndex, positionText, titleOf],
  )

  const onGripKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
      const drag = dragRef.current
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (drag?.id === id) endDrag(false)
        else if (!drag) liftKeyboard(id)
        return
      }
      if (drag?.id !== id || drag.mode !== 'keyboard') return
      if (e.key === 'Escape') {
        e.preventDefault()
        reorderingRef.current = true
        endDrag(true)
        return
      }
      if (moveByKey(id, e.key)) e.preventDefault()
    },
    [endDrag, liftKeyboard, moveByKey],
  )

  const onGripBlur = useCallback(
    (id: string) => {
      const drag = dragRef.current
      if (drag?.mode === 'keyboard' && drag.id === id && !reorderingRef.current) endDrag(false)
    },
    [endDrag],
  )

  // Clean up timers, listeners and the loop on unmount.
  useEffect(
    () => () => {
      cancelPressRef.current()
      removeDragListeners()
      onResizeUp()
      engine.stop()
    },
    [engine, onResizeUp, removeDragListeners],
  )

  const activeId = liftedId ?? resizingId

  // While a cell is held or resized on the 6-column grid, a dot sits at every gutter crossing so the slots it can land in read like a cutting mat.
  const showSlots = activeId !== null && !narrow
  const [slotRows, setSlotRows] = useState(0)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!(showSlots && grid)) return
    setSlotRows(Math.max(1, Math.round((grid.offsetHeight + GAP) / (rowHeight + GAP))))
  }, [showSlots, layoutKey, narrow, rowHeight])
  const slotDots: ReactNode[] = []
  if (showSlots && slotRows > 0) {
    for (let col = 0; col <= COLUMNS; col++) {
      for (let row = 0; row <= slotRows; row++) {
        slotDots.push(
          <circle cx={`${(col / COLUMNS) * 100}%`} cy={`${(row / slotRows) * 100}%`} fill="currentColor" key={`${col}:${row}`} r={1.5} />,
        )
      }
    }
  }

  return (
    <div className={cx('wgrid-wrap', className)} ref={wrapRef}>
      <div
        aria-label={label}
        className={cx('wgrid', narrow && 'is-narrow', activeId !== null && 'is-busy')}
        // Links inside widgets would otherwise start a native drag and cancel the pointer.
        onDragStart={(e) => e.preventDefault()}
        ref={gridRef}
        role="region"
        style={{ gap: GAP, gridAutoRows: narrow ? undefined : rowHeight }}
      >
        {slotDots.length > 0 && (
          <svg
            aria-hidden="true"
            className="wgrid-slots"
            style={{ top: -GAP / 2, left: -GAP / 2, width: `calc(100% + ${GAP}px)`, height: `calc(100% + ${GAP}px)` }}
          >
            {slotDots}
          </svg>
        )}
        {current.map((entry) => {
          const item = itemsById.get(entry.id)
          if (!item) return null
          const id = entry.id
          return (
            <WidgetCell
              cellRef={(el) => {
                if (el) engine.els.set(id, el)
                else engine.els.delete(id)
              }}
              dimmed={activeId !== null && activeId !== id}
              gripRef={(el) => {
                if (el) gripsRef.current.set(id, el)
                else gripsRef.current.delete(id)
              }}
              instructionsId={instructionsId}
              item={item}
              key={id}
              lifted={liftedId === id}
              narrow={narrow}
              onGripBlur={() => onGripBlur(id)}
              onGripKeyDown={(e) => onGripKeyDown(e, id)}
              onGripPointerDown={(e) => {
                if (e.button === 0) {
                  e.preventDefault()
                  cancelPress()
                  liftPointer(id, e.pointerId, e.clientX, e.clientY)
                }
              }}
              onPressStart={(e) => startPress(e, id)}
              onResizeKeyDown={(e) => onResizeKeyDown(e, id)}
              onResizePointerDown={(e) => startResize(e, id)}
              span={entry.span}
            />
          )
        })}
      </div>
      <p className="sr-only" id={instructionsId}>
        Press Space to pick up. Use the arrow keys to move, Space to drop and Escape to cancel. With a pointer, drag the handle, or press
        and hold a widget, then drag it.
      </p>
      <p aria-live="assertive" className="sr-only">
        {message}
      </p>
    </div>
  )
}
