/**
 * Smooth tabs, ported from KokonutUI's Swipe Tabs ("smooth-tab", Tailwind + motion) to this app's CSS.
 *
 * Original: "Swipe Tabs" v2.0.0 by @dorianbaffier, https://kokonutui.com/docs/navigation/smooth-tab
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: the tab bar only (here the tabs filter one list instead of switching panels, so the
 * swipeable panel track is left out); tabs can carry a count; the row scrolls sideways on narrow screens and keeps
 * the selected tab in view; styling uses CSS classes and design tokens. The indicator technique is unchanged: a copy
 * of the labels in the active colour, clipped to the pill, so every label is exactly right at every point of the slide.
 */
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type AnimationPlaybackControls, animate, useMotionValue } from 'motion/react'
import { cx } from '../../lib/cx'

export interface SmoothTabItem<T extends string> {
  value: T
  label: string
  count?: number
}

interface TabRect {
  left: number
  width: number
  top: number
  height: number
}

// Just under critical damping: a firm settle with a hint of overshoot on long jumps.
const SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const
const EASE_OUT = [0.23, 1, 0.32, 1] as const

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** The indicator rectangle at a fractional tab position. */
function indicatorRect(rects: TabRect[], progress: number): TabRect | null {
  const last = rects.length - 1
  if (last < 0) return null
  const p = clamp(progress, 0, last)
  const i = Math.min(Math.floor(p), Math.max(last - 1, 0))
  const a = rects[i]
  const b = rects[Math.min(i + 1, last)]
  const t = p - i
  return { left: lerp(a.left, b.left, t), width: lerp(a.width, b.width, t), top: a.top, height: a.height }
}

export function SmoothTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: SmoothTabItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  const count = items.length
  const selected = Math.max(
    items.findIndex((item) => item.value === value),
    0,
  )
  // Fractional tab position; drives the pill and the label clip directly, so the slide never re-renders React.
  const progress = useMotionValue(selected)
  const [initial] = useState(selected)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const tablistRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const rects = useRef<TabRect[]>([])
  const size = useRef({ width: 0, height: 0 })
  const anim = useRef<AnimationPlaybackControls | null>(null)
  const target = useRef(selected)

  const paint = useCallback((p: number) => {
    const r = indicatorRect(rects.current, p)
    if (!r) return
    const right = size.current.width - r.left - r.width
    const bottom = size.current.height - r.top - r.height
    const clip = `inset(${r.top}px ${right}px ${bottom}px ${r.left}px round 8px)`
    if (overlayRef.current) overlayRef.current.style.clipPath = clip
    if (pillRef.current) pillRef.current.style.clipPath = clip
  }, [])

  // Measure the tabs before paint, and again on resize, font load and count changes.
  useLayoutEffect(() => {
    const tablist = tablistRef.current
    if (!tablist) return
    let alive = true
    const measure = () => {
      if (!alive) return
      const box = tablist.getBoundingClientRect()
      const ratio = box.width / (tablist.offsetWidth || 1)
      const scale = Math.abs(ratio - 1) < 0.01 ? 1 : ratio
      size.current = { width: box.width / scale, height: box.height / scale }
      rects.current = tabRefs.current.slice(0, count).map((tab) => {
        const r = tab?.getBoundingClientRect()
        return r
          ? { left: (r.left - box.left) / scale, width: r.width / scale, top: (r.top - box.top) / scale, height: r.height / scale }
          : { left: 0, width: 0, top: 0, height: 0 }
      })
      paint(progress.get())
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(tablist)
    document.fonts.ready.then(measure).catch(() => undefined)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [count, items, paint, progress])

  useEffect(() => {
    const unsubscribe = progress.on('change', paint)
    return () => {
      unsubscribe()
      anim.current?.stop()
    }
  }, [paint, progress])

  // Follow the selected tab: spring the pill there and keep it scrolled into view.
  useEffect(() => {
    if (selected === target.current) return
    target.current = selected
    anim.current?.stop()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    anim.current = reduced ? animate(progress, selected, { duration: 0.15, ease: EASE_OUT }) : animate(progress, selected, SPRING)
    const tab = tabRefs.current[selected]
    const scroller = scrollerRef.current
    if (tab && scroller && scroller.scrollWidth > scroller.clientWidth) {
      const left = tab.offsetLeft - 16
      const right = tab.offsetLeft + tab.offsetWidth + 16 - scroller.clientWidth
      if (scroller.scrollLeft > left) scroller.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' })
      else if (scroller.scrollLeft < right) scroller.scrollTo({ left: right, behavior: reduced ? 'auto' : 'smooth' })
    }
  }, [selected, progress])

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const keys: Record<string, number> = { ArrowRight: (i + 1) % count, ArrowLeft: (i - 1 + count) % count, Home: 0, End: count - 1 }
    const next = keys[e.key]
    if (next === undefined) return
    e.preventDefault()
    tabRefs.current[next]?.focus()
    if (e.repeat) progress.jump(next)
    onChange(items[next].value)
  }

  const labelOf = (item: SmoothTabItem<T>) => (
    <>
      <span className="stabs-label">{item.label}</span>
      {item.count !== undefined && <span className="stabs-count">{item.count}</span>}
    </>
  )

  return (
    <div className={cx('stabs-scroller', className)} ref={scrollerRef}>
      <div aria-label={label} className="stabs" ref={tablistRef} role="tablist">
        {/* The pill itself, under the labels. */}
        <div aria-hidden className="stabs-pill" ref={pillRef} style={{ clipPath: 'inset(0 100% 0 0)' }} />
        {items.map((item, i) => {
          const isSelected = i === selected
          return (
            <button
              aria-selected={isSelected}
              className="stabs-tab"
              key={item.value}
              onClick={() => onChange(item.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              type="button"
            >
              {labelOf(item)}
            </button>
          )
        })}
        {/* The same labels in the active colour, clipped to the pill. */}
        <div aria-hidden className="stabs-overlay" data-initial={initial} ref={overlayRef} style={{ clipPath: 'inset(0 100% 0 0)' }}>
          {items.map((item) => (
            <span className="stabs-tab is-ghost" key={item.value}>
              {labelOf(item)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
