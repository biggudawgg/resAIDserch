/**
 * Count stepper, ported from KokonutUI's Team Selector (Tailwind + motion) to this app's CSS.
 *
 * Original: "Team Selector" v4.0.0 by @dorianbaffier, https://kokonutui.com/docs/inputs/team-selector
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: generic count instead of team seats; the row of avatars renders any token through
 * `renderToken` (the settings page shows paper tiles); a hint line replaces the price line; CSS classes and tokens.
 * Kept: rolling digits, drag-to-scrub with a rubber band at the bounds, shake at a bound, full keyboard support.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { AnimatePresence, animate, MotionConfig, motion, useMotionValue, useReducedMotion, type Variants } from 'motion/react'
import { cx } from '../../lib/cx'

/** Horizontal pixels of drag per step when scrubbing the number. */
const SCRUB_STEP_PX = 18
/** Furthest the number stretches past a bound, however far you pull. */
const RUBBER_BAND_PX = 14
/** Tokens shown before the row collapses into a "+N" chip. */
const VISIBLE_TOKENS = 6
const TOKEN_OVERLAP = 8
const ROLL_DISTANCE = 10
const SHAKE_DURATION_MS = 280
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const SNAP_BACK = { type: 'spring', stiffness: 600, damping: 32 } as const

const animations = {
  token: {
    visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 28, mass: 0.6 } },
    hidden: { opacity: 0, scale: 0.85, transition: { duration: 0.16, ease: EASE_OUT } },
  } satisfies Variants,
  vibration: {
    idle: { x: 0 },
    shake: { x: [-3, 3, -2, 2, 0] as const, transition: { duration: SHAKE_DURATION_MS / 1000, ease: EASE_OUT } },
  } satisfies Variants,
  // `custom` is the signed offset of the latest change, so leaving digits always exit opposite to entering ones.
  roll: {
    enter: (offset: number) => ({ opacity: 0, y: offset }),
    center: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
    exit: (offset: number) => ({ opacity: 0, y: -offset, transition: { duration: 0.12, ease: EASE_OUT } }),
  } satisfies Variants,
} as const

/** Rolls each character on its own, keyed by its place from the right, so 12 → 13 only moves the last digit. */
function RollingText({ text, offset, className }: { text: string; offset: number; className?: string }) {
  const columns = [...text].map((char, index, all) => ({ char, place: all.length - index }))
  return (
    <span className={cx('cstep-roll', className)}>
      <AnimatePresence custom={offset} initial={false} mode="popLayout">
        {columns.map(({ char, place }) => (
          <motion.span animate="center" className="cstep-roll-col" custom={offset} exit="exit" initial="enter" key={`place-${place}`} variants={animations.roll}>
            <AnimatePresence custom={offset} initial={false} mode="popLayout">
              <motion.span animate="center" className="cstep-roll-char" custom={offset} exit="exit" initial="enter" key={char} variants={animations.roll}>
                {char}
              </motion.span>
            </AnimatePresence>
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  )
}

export function CountStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 12,
  unit,
  renderToken,
  tokenTitle,
  hint,
  className,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** [singular, plural], e.g. ['paper', 'papers']. */
  unit: [string, string]
  /** One token per counted item (index is 0-based). */
  renderToken: (index: number) => ReactNode
  tokenTitle?: (index: number) => string
  hint?: ReactNode
  className?: string
}) {
  const labelId = useId()
  const upperBound = Math.max(min, max)
  const clampCount = (count: number) => Math.min(Math.max(count, min), upperBound)
  const count = clampCount(value)
  const [direction, setDirection] = useState<1 | -1>(1)
  // Direction follows every change, including one made from outside (state adjusted during render).
  const [previousCount, setPreviousCount] = useState(count)
  if (count !== previousCount) {
    setPreviousCount(count)
    setDirection(count > previousCount ? 1 : -1)
  }

  const [isVibrating, setIsVibrating] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const vibrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrubRef = useRef<{ id: number; startX: number; startCount: number } | null>(null)
  const stretchX = useMotionValue(0)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    return () => {
      if (vibrationTimeoutRef.current) clearTimeout(vibrationTimeoutRef.current)
    }
  }, [])

  const triggerVibration = () => {
    if (prefersReducedMotion || vibrationTimeoutRef.current) return
    setIsVibrating(true)
    vibrationTimeoutRef.current = setTimeout(() => {
      setIsVibrating(false)
      vibrationTimeoutRef.current = null
    }, SHAKE_DURATION_MS)
  }

  const changeCount = (next: number) => {
    const clamped = clampCount(next)
    if (clamped !== count) onChange(clamped)
  }

  /** Steps by `delta`, or shakes when the step would cross a bound. */
  const step = (delta: number) => {
    const next = count + delta
    if (next < min || next > upperBound) {
      triggerVibration()
      return
    }
    changeCount(next)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || scrubRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubRef.current = { id: event.pointerId, startX: event.clientX, startCount: count }
    setIsScrubbing(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current
    if (!scrub || scrub.id !== event.pointerId) return
    const travel = event.clientX - scrub.startX
    const raw = scrub.startCount + travel / SCRUB_STEP_PX
    changeCount(Math.round(raw))
    // Past a bound the number keeps following the pointer with growing resistance, never more than RUBBER_BAND_PX.
    let overshoot = 0
    if (raw < min) overshoot = (raw - min) * SCRUB_STEP_PX
    else if (raw > upperBound) overshoot = (raw - upperBound) * SCRUB_STEP_PX
    stretchX.set(Math.sign(overshoot) * RUBBER_BAND_PX * (1 - Math.exp(-Math.abs(overshoot) / (RUBBER_BAND_PX * 4))))
  }

  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (scrubRef.current?.id !== event.pointerId) return
    scrubRef.current = null
    setIsScrubbing(false)
    if (prefersReducedMotion) stretchX.set(0)
    else animate(stretchX, 0, SNAP_BACK)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        step(1)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        step(-1)
        break
      case 'PageUp':
        changeCount(count + 5)
        break
      case 'PageDown':
        changeCount(count - 5)
        break
      case 'Home':
        changeCount(min)
        break
      case 'End':
        changeCount(upperBound)
        break
      default:
        return
    }
    event.preventDefault()
  }

  const rollOffset = direction * (prefersReducedMotion ? 0 : ROLL_DISTANCE)
  const unitText = count === 1 ? unit[0] : unit[1]
  const overflowCount = count > VISIBLE_TOKENS ? count - (VISIBLE_TOKENS - 1) : 0
  const visible = overflowCount ? VISIBLE_TOKENS - 1 : count

  return (
    <div className={cx('cstep', className)}>
      <span className="cstep-label" id={labelId}>
        {label}
      </span>
      <MotionConfig reducedMotion="user">
        {/* Decorative: the spinbutton below carries the value. */}
        <div aria-hidden className="cstep-tokens">
          <AnimatePresence initial={false} mode="popLayout">
            {Array.from({ length: visible }, (_, index) => (
              <motion.div
                animate="visible"
                exit="hidden"
                initial="hidden"
                key={`token-${index}`}
                layout="position"
                style={{ marginLeft: index === 0 ? 0 : -TOKEN_OVERLAP, zIndex: VISIBLE_TOKENS - index }}
                title={tokenTitle?.(index)}
                transition={{ layout: { duration: 0.2, ease: EASE_OUT } }}
                variants={animations.token}
              >
                {renderToken(index)}
              </motion.div>
            ))}
            {overflowCount > 0 && (
              <motion.div
                animate="visible"
                className="cstep-overflow"
                exit="hidden"
                initial="hidden"
                key="overflow"
                layout="position"
                style={{ marginLeft: -TOKEN_OVERLAP, zIndex: 0 }}
                transition={{ layout: { duration: 0.2, ease: EASE_OUT } }}
                variants={animations.token}
              >
                +<RollingText offset={rollOffset} text={String(overflowCount)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.div animate={isVibrating ? 'shake' : 'idle'} className="cstep-controls" initial="idle" variants={animations.vibration}>
          {/* aria-disabled rather than disabled: focus stays put at the bound and the click still reaches the shake. */}
          <button aria-disabled={count <= min} aria-label={`Fewer ${unit[1]}`} className="cstep-btn" onClick={() => step(-1)} type="button">
            <Minus aria-hidden />
          </button>
          {/* Scrub: drag sideways on the number, like a design tool's number field. */}
          <motion.div
            aria-labelledby={labelId}
            aria-valuemax={upperBound}
            aria-valuemin={min}
            aria-valuenow={count}
            aria-valuetext={`${count} ${unitText}`}
            className={cx('cstep-value', isScrubbing && 'is-scrubbing')}
            onKeyDown={handleKeyDown}
            onLostPointerCapture={endScrub}
            onPointerCancel={endScrub}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endScrub}
            role="spinbutton"
            style={{ x: stretchX }}
            tabIndex={0}
          >
            <RollingText className="cstep-number" offset={rollOffset} text={String(count)} />
            <span className="cstep-unit">{unitText}</span>
          </motion.div>
          <button aria-disabled={count >= upperBound} aria-label={`More ${unit[1]}`} className="cstep-btn" onClick={() => step(1)} type="button">
            <Plus aria-hidden />
          </button>
        </motion.div>
        {hint && <p className="cstep-hint">{hint}</p>}
      </MotionConfig>
      <output aria-live="polite" className="sr-only">
        {count} {unitText}
      </output>
    </div>
  )
}
