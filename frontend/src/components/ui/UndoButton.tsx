/**
 * Undo button, ported from KokonutUI's Undo Button (Tailwind + motion) to this app's buttons and tokens.
 *
 * Original: "Undo Button" v1.0.0 by @dorianbaffier, https://kokonutui.com/docs/buttons/undo-button
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: it uses the app's button sizes and variants, and the countdown outline follows the
 * button's rounded rectangle instead of a pill. Leaving the page while the window is open commits the action (the
 * person pressed it and didn't undo), where the original dropped it silently. Ctrl/⌘ Z only undoes the most recent
 * pending button, so two open windows can't both be undone by one key press. The countdown, hover-to-pause, the
 * hidden-tab pause and the rolling seconds are unchanged.
 */
import { type ReactNode, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Undo2 } from 'lucide-react'
import { cx } from '../../lib/cx'
import { isMac } from '../../lib/hooks'

const EASE_OUT = [0.23, 1, 0.32, 1] as const
const STROKE = 1.5

type Phase = 'idle' | 'pending' | 'done'

/** The pending button that Ctrl/⌘ Z belongs to: the one pressed last. */
let latestPending: symbol | null = null

export interface UndoButtonProps {
  /** What the button does, e.g. "Approve". */
  label: string
  /** The same action in the past tense, e.g. "Approved". */
  doneLabel: string
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  /** How long the action can be undone, in ms. */
  duration?: number
  disabled?: boolean
  /** Called when the undo window closes without an undo: do the real work here. */
  onCommit: () => void
  onUndo?: () => void
  /** Told when the undo window opens and closes, e.g. to lock a sibling action meanwhile. */
  onPendingChange?: (pending: boolean) => void
  className?: string
}

/** A rounded rectangle outline that starts at the top centre and runs clockwise, so the countdown drains back to it. */
function outlinePath(width: number, height: number, radius: number) {
  const s = STROKE / 2
  const r = Math.max(0, Math.min(radius - s, height / 2 - s, width / 2 - s))
  const w = width - s
  const h = height - s
  return [
    `M ${width / 2} ${s}`,
    `H ${w - r}`,
    `A ${r} ${r} 0 0 1 ${w} ${s + r}`,
    `V ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `H ${s + r}`,
    `A ${r} ${r} 0 0 1 ${s} ${h - r}`,
    `V ${s + r}`,
    `A ${r} ${r} 0 0 1 ${s + r} ${s}`,
    'Z',
  ].join(' ')
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function UndoButton({
  label,
  doneLabel,
  icon,
  variant = 'secondary',
  size = 'md',
  duration = 5000,
  disabled,
  onCommit,
  onUndo,
  onPendingChange,
  className,
}: UndoButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(Math.ceil(duration / 1000))
  const [width, setWidth] = useState<number>()
  const reduceMotion = useReducedMotion()

  const buttonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const hoveredRef = useRef(false)
  const elapsedRef = useRef(0)
  const remainingRef = useRef(1)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const token = useRef(Symbol('undo'))

  const callbacks = useRef({ onCommit, onUndo, onPendingChange })
  callbacks.current = { onCommit, onUndo, onPendingChange }

  const firstPhase = useRef(true)
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false
      return
    }
    callbacks.current.onPendingChange?.(phase === 'pending')
  }, [phase])

  // The width follows the label, so the button grows into "Approved | Undo 5" instead of jumping.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => setWidth(content.offsetWidth + 2))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // Dashes in real lengths rather than pathLength, which Chrome scales inconsistently once the path changes size.
  const paint = useCallback(() => {
    const path = pathRef.current
    if (!path) return
    const length = path.getTotalLength()
    path.style.strokeDasharray = `${length * remainingRef.current} ${length}`
  }, [])

  // Keep the outline glued to the button while its width animates.
  useLayoutEffect(() => {
    const button = buttonRef.current
    if (!button) return
    const observer = new ResizeObserver(() => {
      const radius = parseFloat(getComputedStyle(button).borderTopLeftRadius) || 8
      pathRef.current?.setAttribute('d', outlinePath(button.offsetWidth, button.offsetHeight, radius))
      paint()
    })
    observer.observe(button)
    return () => observer.disconnect()
  }, [paint])

  const undo = useCallback(() => {
    setPhase('idle')
    if (latestPending === token.current) latestPending = null
    callbacks.current.onUndo?.()
  }, [])

  const commit = useCallback(() => {
    setPhase('done')
    if (latestPending === token.current) latestPending = null
    callbacks.current.onCommit()
  }, [])

  useEffect(() => {
    if (phase !== 'pending') return
    elapsedRef.current = 0
    remainingRef.current = 1
    paint()
    setSeconds(Math.ceil(duration / 1000))

    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Hovering the button, or leaving the tab, holds the clock: nobody should lose their chance to undo while reading it.
      if (!(hoveredRef.current || document.hidden)) elapsedRef.current += now - last
      last = now
      const left = Math.max(0, duration - elapsedRef.current)
      remainingRef.current = left / duration
      paint()
      setSeconds(Math.ceil(left / 1000))
      if (left === 0) {
        commit()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'z' && !isEditable(event.target) && latestPending === token.current) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [phase, duration, paint, undo, commit])

  // Leaving the page mid-countdown still does what was asked.
  useEffect(
    () => () => {
      if (phaseRef.current === 'pending') {
        if (latestPending === token.current) latestPending = null
        callbacks.current.onCommit()
      }
    },
    [],
  )

  const handleClick = () => {
    if (phase === 'idle') {
      latestPending = token.current
      setPhase('pending')
    } else if (phase === 'pending') {
      undo()
    }
  }

  const setHovered = (event: PointerEvent, value: boolean) => {
    if (event.pointerType === 'mouse') hoveredRef.current = value
  }

  const swap = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }
  const ariaLabel = {
    idle: label,
    pending: `${doneLabel}. Undo, ${seconds} second${seconds === 1 ? '' : 's'} left`,
    done: doneLabel,
  }[phase]

  return (
    <span className="undo-wrap">
      <motion.button
        animate={{ width: width ?? 'auto' }}
        aria-disabled={phase === 'done' || undefined}
        aria-label={ariaLabel}
        className={cx('btn', `btn-${size}`, 'undo-btn', phase === 'idle' ? `btn-${variant}` : 'btn-secondary', phase === 'done' && 'is-done', className)}
        disabled={disabled && phase === 'idle'}
        initial={false}
        onClick={handleClick}
        onPointerEnter={(event) => setHovered(event, true)}
        onPointerLeave={(event) => setHovered(event, false)}
        ref={buttonRef}
        transition={swap}
        type="button"
      >
        <span className="undo-content" ref={contentRef}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              className="undo-face"
              exit={{ opacity: 0, y: -8, filter: 'blur(2px)' }}
              initial={{ opacity: 0, y: 8, filter: 'blur(2px)' }}
              key={phase}
              transition={swap}
            >
              {phase === 'idle' && (
                <>
                  {icon}
                  {label}
                </>
              )}
              {phase === 'pending' && (
                <>
                  <span className="undo-done-label">{doneLabel}</span>
                  <span aria-hidden className="undo-sep" />
                  <Undo2 aria-hidden />
                  Undo
                  <Countdown reduceMotion={Boolean(reduceMotion)} value={seconds} />
                  <kbd className="undo-kbd">{isMac ? '⌘Z' : 'Ctrl Z'}</kbd>
                </>
              )}
              {phase === 'done' && (
                <>
                  <Check aria-hidden />
                  {doneLabel}
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
      <svg aria-hidden className="undo-ring">
        <motion.path
          animate={{ opacity: phase === 'pending' ? 1 : 0 }}
          fill="none"
          initial={false}
          ref={pathRef}
          strokeLinecap="round"
          strokeWidth={STROKE}
          transition={{ duration: phase === 'pending' ? 0.15 : 0.2 }}
        />
      </svg>
      <span aria-live="polite" className="sr-only">
        {phase === 'pending' && `${doneLabel}. Press the button or ${isMac ? 'Command' : 'Control'} Z to undo.`}
        {phase === 'done' && doneLabel}
      </span>
    </span>
  )
}

function Countdown({ value, reduceMotion }: { value: number; reduceMotion: boolean }) {
  return (
    <span className="undo-count">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          initial={{ y: 10, opacity: 0 }}
          key={value}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
