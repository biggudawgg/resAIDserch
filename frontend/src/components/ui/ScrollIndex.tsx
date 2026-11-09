/**
 * A section rail for long pages, ported from KokonutUI's Scroll Index ("scroll-index", Tailwind).
 *
 * Original: "Scroll Index" by @dorianbaffier, https://kokonutui.com/docs/navigation/scroll-index
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: only the page-scroll mode is kept (this app scrolls the window). Sections are any
 * element with a `data-section` attribute, named by its value, rather than h2/h3 headings, so a card can be indexed
 * by its role; they are ordered by where they sit on the page. Jumps land below the sticky top bar. The rail is
 * fixed in the page's right gutter so the content keeps its width, and hides on narrow screens (CSS). Styling uses
 * CSS classes and design tokens. The dock-like swell, the reading head, the flashed section name, drag-to-scrub with
 * a flick snap, and the keyboard rail are unchanged.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

const RAIL = 240
/** Sections land this far below the top of the viewport when jumped to: the top bar plus a little air. */
const OFFSET = 72
const SWELL = 1.6
const REACH = 26
const SNAP = 18
const FLASH = 900

function easeInOut(t: number) {
  return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2
}

/** Marks each tick ahead, current or passed, and keeps one tab stop. */
function markTicks(ticks: (HTMLButtonElement | null)[], active: number) {
  ticks.forEach((tick, i) => {
    if (!tick) return
    tick.dataset.state = i === active ? 'current' : i < active ? 'passed' : 'ahead'
    tick.tabIndex = i === Math.max(active, 0) ? 0 : -1
    if (i === active) tick.setAttribute('aria-current', 'location')
    else tick.removeAttribute('aria-current')
  })
}

interface Section {
  el: HTMLElement
  text: string
  at: number
  pos: number
}

export function ScrollIndex({ children, label = 'Sections' }: { children: ReactNode; label?: string }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const tickRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [sections, setSections] = useState<{ text: string; pos: number }[]>([])
  const api = useRef<{ jump: (index: number) => void; show: (i: number) => void; refresh: () => void }>({
    jump: () => undefined,
    show: () => undefined,
    refresh: () => undefined,
  })

  useEffect(() => {
    const content = contentRef.current
    const rail = railRef.current
    const head = headRef.current
    const labelEl = labelRef.current
    if (!(content && rail && head && labelEl)) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let list: Section[] = []
    let start = 0
    let end = 1
    let active = -1
    let height = RAIL
    let raf = 0
    let tween = 0
    let flashTimer = 0
    let painted = false
    let hover: number | null = null
    let drag: { id: number; moved: boolean; y: number; t: number; v: number } | null = null
    const swell: number[] = []
    let lastKey = ''

    const measure = () => {
      const scroll = window.scrollY
      const top = content.getBoundingClientRect().top + scroll
      start = Math.max(top - OFFSET, 0)
      end = Math.max(top + content.offsetHeight - window.innerHeight, start + 1)
      list = Array.from(content.querySelectorAll<HTMLElement>('[data-section]'))
        .map((el) => {
          const at = Math.min(Math.max(el.getBoundingClientRect().top + scroll - OFFSET, start), end)
          return { el, text: el.dataset.section ?? '', at, pos: (at - start) / (end - start) }
        })
        .sort((a, b) => a.at - b.at)
      height = rail.clientHeight || RAIL
      // Only re-render when the sections actually changed, not on every resize tick.
      const key = list.map((s) => `${s.text}@${s.pos.toFixed(3)}`).join('|')
      if (key !== lastKey) {
        lastKey = key
        setSections(list.map(({ text, pos }) => ({ text, pos })))
      }
    }

    const fraction = () => Math.min(Math.max((window.scrollY - start) / (end - start), 0), 1)
    const nearest = (y: number) => {
      let best = -1
      let distance = Number.POSITIVE_INFINITY
      list.forEach((s, i) => {
        const d = Math.abs(s.pos * height - y)
        if (d < distance) {
          distance = d
          best = i
        }
      })
      return { index: best, distance }
    }
    const placeLabel = (index: number, visible: boolean) => {
      const section = list[index]
      if (!section) {
        labelEl.style.opacity = '0'
        return
      }
      if (labelEl.textContent !== section.text) labelEl.textContent = section.text
      labelEl.style.transform = `translate3d(0, ${(section.pos * height).toFixed(1)}px, 0) translateY(-50%)`
      labelEl.style.opacity = visible ? '1' : '0'
    }
    /** Section the reader is in: the last one whose top has reached the top bar. */
    const current = () => {
      const scroll = window.scrollY + 1
      let index = -1
      for (let i = 0; i < list.length; i++) if (list[i].at <= scroll) index = i
      return index
    }
    const paint = () => {
      raf = 0
      head.style.transform = `translate3d(0, ${(fraction() * height).toFixed(1)}px, 0)`
      const now = current()
      if (now !== active) {
        active = now
        markTicks(tickRefs.current, active)
        // Scrolling into a new section names it briefly.
        if (painted && hover === null && !drag && active >= 0) {
          placeLabel(active, true)
          window.clearTimeout(flashTimer)
          flashTimer = window.setTimeout(() => {
            if (hover === null && !drag) labelEl.style.opacity = '0'
          }, FLASH)
        }
      }
      // Ticks ease toward their swell, so the magnification follows the pointer smoothly.
      let moving = false
      tickRefs.current.forEach((tick, i) => {
        if (!tick) return
        const y = (list[i]?.pos ?? 0) * height
        const target = hover === null || reduceMotion ? 1 : 1 + SWELL * Math.exp(-((hover - y) ** 2) / (2 * REACH * REACH))
        const value = (swell[i] ?? 1) + (target - (swell[i] ?? 1)) * 0.35
        swell[i] = Math.abs(value - target) < 0.005 ? target : value
        moving ||= swell[i] !== target
        tick.style.setProperty('--swell', swell[i].toFixed(3))
      })
      painted = true
      if (moving) schedule()
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    const stopTween = () => {
      cancelAnimationFrame(tween)
      tween = 0
    }
    const scrollTo = (target: number) => {
      stopTween()
      const from = window.scrollY
      const to = Math.max(target, 0)
      if (reduceMotion || Math.abs(to - from) < 2) {
        window.scrollTo(0, to)
        return
      }
      const duration = Math.min(Math.max(260 + Math.abs(to - from) * 0.12, 300), 650)
      const begin = performance.now()
      const step = (now: number) => {
        const t = Math.min((now - begin) / duration, 1)
        window.scrollTo(0, from + (to - from) * easeInOut(t))
        tween = t < 1 ? requestAnimationFrame(step) : 0
      }
      tween = requestAnimationFrame(step)
    }

    api.current = {
      jump: (index) => {
        const section = list[index]
        if (section) scrollTo(section.at)
      },
      show: (index) => {
        hover = (list[index]?.pos ?? 0) * height
        placeLabel(index, true)
        schedule()
      },
      refresh: () => {
        active = -2
        schedule()
      },
    }

    const railY = (event: PointerEvent) => Math.min(Math.max(event.clientY - rail.getBoundingClientRect().top, 0), height)
    const scrub = (y: number) => window.scrollTo(0, start + (y / height) * (end - start))
    const onDown = (event: PointerEvent) => {
      if (drag || event.button !== 0) return
      event.preventDefault()
      rail.setPointerCapture(event.pointerId)
      stopTween()
      const y = railY(event)
      drag = { id: event.pointerId, moved: false, y, t: event.timeStamp, v: 0 }
      hover = y
      rail.dataset.dragging = ''
      placeLabel(nearest(y).index, true)
      schedule()
    }
    const onMove = (event: PointerEvent) => {
      const y = railY(event)
      if (drag && event.pointerId === drag.id) {
        const dt = Math.max(event.timeStamp - drag.t, 1)
        drag.v = drag.v * 0.4 + ((y - drag.y) / dt) * 0.6
        drag.moved ||= Math.abs(y - drag.y) > 3
        drag.y = y
        drag.t = event.timeStamp
        // Dragging the rail scrubs the page under it.
        if (drag.moved) scrub(y)
      } else if (event.pointerType !== 'mouse') {
        return
      }
      hover = y
      placeLabel(nearest(y).index, true)
      schedule()
    }
    const onUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const { moved, y, v } = drag
      drag = null
      delete rail.dataset.dragging
      if (event.pointerType !== 'mouse') {
        hover = null
        placeLabel(-1, false)
      }
      // Where the flick was heading, then the tick nearest that.
      const hit = nearest(moved ? y + v * 120 : y)
      if (hit.index >= 0 && (!moved || hit.distance < SNAP)) api.current.jump(hit.index)
      schedule()
    }
    const onLeave = () => {
      if (drag) return
      hover = null
      placeLabel(-1, false)
      schedule()
    }
    const onScroll = () => schedule()
    // Any scroll input of the reader's own cancels a jump in progress.
    const onInput = () => stopTween()

    measure()
    paint()
    const resize = new ResizeObserver(() => {
      measure()
      schedule()
    })
    resize.observe(content)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', onInput, { passive: true })
    window.addEventListener('touchstart', onInput, { passive: true })
    rail.addEventListener('pointerdown', onDown)
    rail.addEventListener('pointermove', onMove)
    rail.addEventListener('pointerup', onUp)
    rail.addEventListener('pointercancel', onUp)
    rail.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      stopTween()
      window.clearTimeout(flashTimer)
      resize.disconnect()
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onInput)
      window.removeEventListener('touchstart', onInput)
      rail.removeEventListener('pointerdown', onDown)
      rail.removeEventListener('pointermove', onMove)
      rail.removeEventListener('pointerup', onUp)
      rail.removeEventListener('pointercancel', onUp)
      rail.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  // Ticks were re-created: give them their state right away rather than on the next scroll.
  useEffect(() => {
    tickRefs.current.length = sections.length
    api.current.refresh()
  }, [sections])

  const onTickKey = (index: number, event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), sections.length - 1)
    tickRefs.current[next]?.focus()
  }

  return (
    <>
      <div className="sindex-content" ref={contentRef}>
        {children}
      </div>
      <nav aria-label={label} className="sindex-nav">
        <div className="sindex-rail" ref={railRef} style={{ height: RAIL }}>
          {sections.map((section, index) => (
            <button
              aria-label={section.text}
              className="sindex-tick"
              data-state="ahead"
              key={`${index}-${section.text}`}
              onBlur={() => labelRef.current?.style.setProperty('opacity', '0')}
              onClick={(event) => {
                // Pointer clicks are handled by the rail; this is the keyboard.
                if (event.detail === 0) api.current.jump(index)
              }}
              onFocus={() => api.current.show(index)}
              onKeyDown={(event) => onTickKey(index, event)}
              ref={(el) => {
                tickRefs.current[index] = el
              }}
              style={{ top: `${(section.pos * 100).toFixed(3)}%` }}
              tabIndex={index === 0 ? 0 : -1}
              type="button"
            >
              <span className="sindex-line" />
            </button>
          ))}
          {/* Where the reader is, between ticks too. */}
          <span aria-hidden className="sindex-head" ref={headRef} />
          <span aria-hidden className="sindex-label" ref={labelRef} />
        </div>
      </nav>
    </>
  )
}
