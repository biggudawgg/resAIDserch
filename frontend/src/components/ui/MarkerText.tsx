/**
 * Hand-drawn marks over text, ported from KokonutUI's Marker Text ("marker-text", Tailwind).
 *
 * Original: "Marker Text" by @dorianbaffier, https://kokonutui.com/docs/texts/marker-text
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: only the highlight and underline marks are kept (the app marks quotes; circle, box and
 * strike are left out), colours default to the app's highlight token and can be any CSS value including var(), and
 * the ink is painted with `style.fill` so tokens follow the theme. Styling uses CSS classes. The pressure-shaped
 * strokes, the chisel highlighter, the masked pen that draws in reading order, the deterministic wobble and the
 * `show` control are unchanged.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../lib/cx'

export type MarkType = 'highlight' | 'underline'

type Pt = [number, number]
interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}
interface Stroke {
  key: string
  shape: string
  pen: string
  penWidth: number
  length: number
  color: string
  under: boolean
  alpha: number
  delay: number
  duration: number
}
interface Entry {
  el: HTMLElement
  type: MarkType
  color?: string
}

const DEFAULT_COLOR: Record<MarkType, string> = { highlight: 'var(--highlight)', underline: 'var(--accent)' }
const PEN_SPEED = 0.9
const HIGHLIGHT_SPEED = 1.15
const MIN_MS = 260
const MAX_MS = 820
const LINE_GAP = 60
const PEN_EASE = 'cubic-bezier(0.45, 0.05, 0.25, 1)'
const MASK_SPAN = 20_000

/** Deterministic noise, so a resize redraws the same wobble. */
function random(seed: number) {
  let n = seed
  return () => {
    n += 1
    const x = Math.sin(n * 12.9898 + seed * 78.233) * 43_758.5453
    return x - Math.floor(x)
  }
}

function hash(text: string) {
  let h = 7
  for (const char of text) h = (h * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003
  return h
}

const r1 = (n: number) => Math.round(n * 10) / 10
const polyline = (points: Pt[]) => points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('')

function lengthOf(points: Pt[]) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return total
}

/** A pen stroke as a filled shape whose width varies along the way, which is what makes it read as ink. */
function outline(points: Pt[], widths: number[]) {
  const left: Pt[] = []
  const right: Pt[] = []
  const last = points.length - 1
  for (let i = 0; i <= last; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(last, i + 1)]
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    const half = widths[i] / 2
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    left.push([points[i][0] + nx, points[i][1] + ny])
    right.push([points[i][0] - nx, points[i][1] - ny])
  }
  const endCap = r1(widths[last] / 2)
  const startCap = r1(widths[0] / 2)
  const back = right.reverse()
  return `${polyline(left)}A${endCap} ${endCap} 0 0 0 ${r1(back[0][0])} ${r1(back[0][1])}${polyline(back).replace('M', 'L')}A${startCap} ${startCap} 0 0 0 ${r1(left[0][0])} ${r1(left[0][1])}Z`
}

/** Pressure along a stroke: the pen lands, presses, then lifts off. */
function pressure(t: number, base: number) {
  const land = Math.min(1, t / 0.1)
  const lift = Math.min(1, (1 - t) / 0.18)
  return base * (0.45 + 0.55 * Math.sin((land * Math.PI) / 2)) * (0.55 + 0.45 * lift)
}

/** A slow, uneven wave for edges that should look hand drawn. */
function wobble(rand: () => number, amp: number) {
  const p1 = rand() * Math.PI * 2
  const p2 = rand() * Math.PI * 2
  const f1 = 1 + rand() * 1.5
  const f2 = 3 + rand() * 3
  return (t: number) => amp * (0.7 * Math.sin(t * f1 * Math.PI + p1) + 0.3 * Math.sin(t * f2 * Math.PI + p2))
}

function sample(count: number, at: (t: number) => Pt) {
  const points: Pt[] = []
  for (let i = 0; i <= count; i++) points.push(at(i / count))
  return points
}

function strokesFor(entry: Entry, lines: Rect[], seed: number, index: number): Omit<Stroke, 'delay' | 'duration'>[] {
  const rand = random(seed)
  const color = entry.color ?? DEFAULT_COLOR[entry.type]
  const lineHeight = lines[0].bottom - lines[0].top
  const width = Math.min(4.5, Math.max(1.6, lineHeight * 0.085))

  if (entry.type === 'highlight') {
    return lines.map((line, i) => {
      const h = line.bottom - line.top
      const top = wobble(rand, 0.9)
      const bottom = wobble(rand, 0.9)
      // The chisel tip leaves slanted ends, and the stroke drifts a little off level across the line.
      const chisel = h * 0.2
      const tilt = (rand() - 0.5) * Math.min(3, h * 0.08)
      const x0 = line.left - 3 - rand() * 2
      const x1 = line.right + 3 + rand() * 3
      const y0 = line.top + h * 0.08
      const y1 = line.bottom - h * 0.02
      const steps = Math.max(6, Math.round((x1 - x0) / 14))
      const edge = (y: number, wave: (t: number) => number, dx: number) => sample(steps, (t) => [x0 + dx + (x1 - x0) * t, y + wave(t) + tilt * (t - 0.5)])
      const upper = edge(y0, top, chisel * 0.5)
      const lower = edge(y1, bottom, -chisel * 0.5).reverse()
      const mid = (y0 + y1) / 2
      const pen: Pt[] = [
        [x0 - chisel, mid],
        [x1 + chisel, mid + tilt * 0.5],
      ]
      return {
        key: `${index}-${i}`,
        shape: `${polyline(upper)}${polyline(lower).replace('M', 'L')}Z`,
        pen: polyline(pen),
        penWidth: h * 1.8,
        length: lengthOf(pen),
        color,
        under: true,
        alpha: 0.5,
      }
    })
  }

  return lines.map((line, i) => {
    const h = line.bottom - line.top
    const bow = (rand() - 0.5) * 3
    const slope = (rand() - 0.5) * 2.4
    const wave = wobble(rand, 0.5)
    const x0 = line.left - 2 - rand() * 3
    const x1 = line.right + 2 + rand() * 4
    const y = line.bottom + Math.max(1, h * 0.04)
    const steps = Math.max(8, Math.round((x1 - x0) / 6))
    const points = sample(steps, (t) => [x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI) * bow + slope * (t - 0.5) + wave(t)])
    const widths = points.map((_, j) => pressure(j / (points.length - 1), width))
    return {
      key: `${index}-${i}`,
      shape: outline(points, widths),
      pen: polyline(points),
      penWidth: width * 4,
      length: lengthOf(points),
      color,
      under: false,
      alpha: 1,
    }
  })
}

interface Registry {
  add: (id: string, entry: Entry) => () => void
}

const MarkerContext = createContext<Registry | null>(null)

/** A phrase to mark, inside MarkerText. Highlights render as <mark>, so the meaning survives without the drawing. */
export function Mark({ children, type = 'highlight', color, className }: { children: ReactNode; type?: MarkType; color?: string; className?: string }) {
  const registry = useContext(MarkerContext)
  const ref = useRef<HTMLElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!(registry && ref.current)) return
    return registry.add(id, { el: ref.current, type, color })
  }, [registry, id, type, color])
  const Tag = type === 'highlight' ? 'mark' : 'span'
  return (
    <Tag className={cx('marker-mark', className)} data-mark={type} ref={ref}>
      {children}
    </Tag>
  )
}

export function MarkerText({
  children,
  show,
  gap = 140,
  onDrawn,
  className,
}: {
  children: ReactNode
  /** true draws the marks, false hides them. Left out, they draw once when the text is mostly on screen. */
  show?: boolean
  gap?: number
  onDrawn?: () => void
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const entries = useRef(new Map<string, Entry>())
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [seen, setSeen] = useState(false)
  // `armed` turns the transitions on. Hiding is instant, drawing is not.
  const [armed, setArmed] = useState(false)
  const [reduced, setReduced] = useState(false)
  const measureRef = useRef<() => void>(() => undefined)
  const onDrawnRef = useRef(onDrawn)
  onDrawnRef.current = onDrawn
  const maskId = useId().replace(/:/g, '')
  const visible = show ?? seen

  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    // Reading order is document order, whatever order the marks mounted in.
    const order = Array.from(root.querySelectorAll('[data-mark]'))
    const ordered = [...entries.current.values()].sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el))
    const next: Stroke[] = []
    let clock = 0
    ordered.forEach((entry, index) => {
      const lines = Array.from(entry.el.getClientRects())
        .filter((r) => r.width > 1)
        .map((r) => ({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }))
      if (lines.length === 0) return
      const seed = hash(`${entry.el.textContent ?? ''}${index}`)
      const speed = entry.type === 'highlight' ? HIGHLIGHT_SPEED : PEN_SPEED
      const made = strokesFor(entry, lines, seed, index)
      made.forEach((stroke, i) => {
        const duration = Math.min(MAX_MS, Math.max(MIN_MS, stroke.length / speed))
        next.push({ ...stroke, delay: clock, duration })
        clock += duration + (i < made.length - 1 ? LINE_GAP : 0)
      })
      clock += gap
    })
    setStrokes(next)
  }, [gap])
  measureRef.current = measure

  const registry = useRef<Registry>({
    add: (id, entry) => {
      entries.current.set(id, entry)
      measureRef.current()
      return () => {
        entries.current.delete(id)
        measureRef.current()
      }
    },
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const resize = new ResizeObserver(() => measureRef.current())
    resize.observe(root)
    // Web fonts can swap in after the first measure and move every line.
    document.fonts?.ready.then(() => measureRef.current()).catch(() => undefined)
    const view = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          view.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    view.observe(root)
    return () => {
      resize.disconnect()
      view.disconnect()
    }
  }, [])

  // Draw on the frame after the hidden state has painted, so going from hidden to shown always runs the transition.
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmed(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [visible])

  const totalRef = useRef(0)
  totalRef.current = strokes.reduce((end, s) => Math.max(end, s.delay + s.duration), 0)
  const hasStrokes = strokes.length > 0
  useEffect(() => {
    if (!(armed && hasStrokes)) return
    const timer = window.setTimeout(() => onDrawnRef.current?.(), reduced ? 0 : totalRef.current)
    return () => window.clearTimeout(timer)
  }, [armed, hasStrokes, reduced])

  const layer = (under: boolean) => (
    <svg aria-hidden className={cx('marker-layer', under ? 'is-under' : 'is-over')} height="1" width="1">
      {strokes
        .filter((s) => s.under === under)
        .map((s) => {
          const id = `${maskId}-${s.key}`
          return (
            <g key={s.key}>
              <mask height={MASK_SPAN} id={id} maskUnits="userSpaceOnUse" width={MASK_SPAN} x={-MASK_SPAN / 2} y={-MASK_SPAN / 2}>
                <path
                  d={s.pen}
                  fill="none"
                  stroke="white"
                  strokeDasharray={s.length + 1}
                  strokeDashoffset={armed ? 0 : s.length + 1}
                  strokeLinecap={under ? 'butt' : 'round'}
                  strokeLinejoin="round"
                  strokeWidth={s.penWidth}
                  style={{ transition: armed && !reduced ? `stroke-dashoffset ${s.duration}ms ${PEN_EASE} ${s.delay}ms` : 'none' }}
                />
              </mask>
              <path d={s.shape} mask={`url(#${id})`} style={{ fill: s.color, fillOpacity: s.alpha }} />
            </g>
          )
        })}
    </svg>
  )

  return (
    <MarkerContext.Provider value={registry.current}>
      <div className={cx('marker-root', className)} ref={rootRef}>
        {layer(true)}
        {children}
        {layer(false)}
      </div>
    </MarkerContext.Provider>
  )
}
