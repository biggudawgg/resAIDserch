/**
 * Avatar Picker, ported from KokonutUI (Tailwind + motion) to this app's CSS.
 *
 * Original: "Avatar Picker" v2.0.0 by @dorianbaffier, https://kokonutui.com/docs/inputs/avatar-picker
 * Copyright (c) Kokonut Labs. Licensed under the MIT License, https://github.com/kokonut-labs/kokonutui
 *
 * Changes from the original: faces are generated from the member's name (no name field); the choice is saved in this
 * browser and shown as your avatar in the app; brighter palettes (see lib/faces.ts); CSS classes and tokens.
 * Kept: the 3D coin you drag, flick or tap to spin, the turning bezel, five comparison slots that fly faces in and out,
 * live eyes that follow the pointer and blink, and the feature-by-feature morph between faces.
 */
import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, Dices, RotateCcw } from 'lucide-react'
import {
  type AnimationPlaybackControls,
  animate,
  LayoutGroup,
  MotionConfig,
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { avatarSeed, createFace, readAvatarVariant, round2, saveAvatarVariant } from '../../lib/faces'
import { cx } from '../../lib/cx'
import { MorphingFace } from '../ui/Face'

const SLOT_COUNT = 5
const COIN = 128
const BEZEL = 176
const TICKS = 60
// One face per half turn. Dragging the coin its own width turns it half a turn.
const DEG_PER_PX = 180 / COIN
const MAX_FLICK_STEPS = 10
const TAP_SLOP = 4
const DRAG_SPRING = { type: 'spring', stiffness: 140, damping: 22 } as const
const SHUFFLE_SPRING = { type: 'spring', stiffness: 50, damping: 11 } as const
const FLY = { type: 'spring', bounce: 0.18, visualDuration: 0.45 } as const

const pad3 = (v: number) => String(((v % 1000) + 1000) % 1000).padStart(3, '0')

// Bezel tick marks.
const TICK_LINES = Array.from({ length: TICKS }, (_, i) => {
  const a = (i / TICKS) * Math.PI * 2
  const long = i % 5 === 0
  const r1 = BEZEL / 2 - 3
  const r0 = r1 - (long ? 7 : 4)
  const c = BEZEL / 2
  return { key: i, long, x1: round2(c + Math.sin(a) * r0), y1: round2(c - Math.cos(a) * r0), x2: round2(c + Math.sin(a) * r1), y2: round2(c - Math.cos(a) * r1) }
})

function useInView(ref: RefObject<HTMLElement>) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let onScreen = false
    const update = () => setActive(onScreen && !document.hidden)
    const io = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting)
      update()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', update)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [ref])
  return active
}

/** Eyes drift toward the pointer and blink now and then, only while visible. */
function useLivingEyes(coinRef: RefObject<HTMLDivElement>, active: boolean) {
  const reduceMotion = useReducedMotion()
  const x = useSpring(0, { stiffness: 180, damping: 18 })
  const y = useSpring(0, { stiffness: 180, damping: 18 })
  const blinkRef = useRef<SVGGElement>(null)

  useEffect(() => {
    if (!active || reduceMotion) return
    const onMove = (e: globalThis.PointerEvent) => {
      const el = coinRef.current
      if (!el) return
      const box = el.getBoundingClientRect()
      const dx = e.clientX - (box.left + box.width / 2)
      const dy = e.clientY - (box.top + box.height / 2)
      const dist = Math.hypot(dx, dy) || 1
      const reach = Math.min(1, dist / 220)
      x.set((dx / dist) * reach * 1.8)
      y.set((dy / dist) * reach * 1.3)
    }
    let timer = 0
    let open = 0
    const blink = () => {
      const g = blinkRef.current
      if (g) {
        g.style.transform = 'scaleY(0.1)'
        open = window.setTimeout(() => {
          g.style.transform = ''
        }, 120)
      }
      timer = window.setTimeout(blink, 2600 + Math.random() * 3400)
    }
    timer = window.setTimeout(blink, 1800)
    window.addEventListener('pointermove', onMove, { passive: true })
    const g = blinkRef.current
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(open)
      if (g) g.style.transform = ''
      window.removeEventListener('pointermove', onMove)
    }
  }, [active, reduceMotion, coinRef, x, y])

  return { look: { x, y }, blinkRef }
}

interface CoinProps {
  layoutId: string
  seed: string
  angle: MotionValue<number>
  spinning: boolean
  label: string
  look: { x: MotionValue<number>; y: MotionValue<number> }
  blinkRef: RefObject<SVGGElement>
  coinRef: RefObject<HTMLDivElement>
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void
}

/** The preview is a coin with real thickness: a stack of discs in 3D that swaps faces as it passes edge-on. */
function Coin({ layoutId, seed, angle, spinning, label, look, blinkRef, coinRef, ...handlers }: CoinProps) {
  // Fold the running angle into -90..90 so the front always faces us.
  const tilt = useTransform(angle, (a) => a - 180 * Math.round(a / 180))
  const transform = useTransform(tilt, (t) => `rotateY(${round2(t)}deg)`)
  const shade = useTransform(tilt, (t) => round2((Math.abs(t) / 90) * 0.35))

  return (
    <motion.div className="apick-coin" layoutId={layoutId} ref={coinRef} style={{ width: COIN, height: COIN, perspective: 600 }} transition={FLY} {...handlers}>
      <motion.div aria-label={label} className="apick-coin-body" role="img" style={{ transform, transformStyle: 'preserve-3d' }}>
        {[6, 5, 4, 3, 2, 1].map((z) => (
          <div aria-hidden className="apick-coin-edge" key={z} style={{ transform: `translateZ(-${z}px)` }} />
        ))}
        <div className="apick-coin-face">
          <MorphingFace blinkRef={blinkRef} look={look} morph={!spinning} seed={seed} />
          <motion.div aria-hidden className="apick-coin-shade" style={{ opacity: shade }} />
        </div>
      </motion.div>
    </motion.div>
  )
}

function useSpinner(onLand: (steps: number) => void) {
  const angle = useMotionValue(0)
  const [step, setStep] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const controls = useRef<AnimationPlaybackControls | null>(null)
  const stepRef = useRef(0)
  const onLandRef = useRef(onLand)
  onLandRef.current = onLand

  useMotionValueEvent(angle, 'change', (a) => {
    const s = Math.round(a / 180)
    if (s !== stepRef.current) {
      stepRef.current = s
      setStep(s)
    }
  })

  const land = useCallback(() => {
    controls.current = null
    const s = Math.round(angle.get() / 180)
    angle.jump(0)
    stepRef.current = 0
    setStep(0)
    setSpinning(false)
    if (s !== 0) onLandRef.current(s)
  }, [angle])

  const stop = useCallback(() => {
    controls.current?.stop()
    controls.current = null
  }, [])

  const spinTo = useCallback(
    (steps: number, transition: { stiffness: number; damping: number; velocity: number }) => {
      stop()
      setSpinning(true)
      controls.current = animate(angle, steps * 180, { type: 'spring', ...transition, restDelta: 0.5, restSpeed: 4, onComplete: land })
    },
    [angle, land, stop],
  )

  const jumpBy = useCallback(
    (steps: number) => {
      stop()
      angle.jump(steps * 180)
      land()
    },
    [angle, land, stop],
  )

  return { angle, step, spinning, setSpinning, spinTo, jumpBy, stop, land }
}

type Spinner = ReturnType<typeof useSpinner>

interface DragState {
  id: number
  x: number
  start: number
  moved: boolean
  samples: { x: number; t: number }[]
}

function releaseTarget(d: DragState, current: number, x: number, t: number) {
  const first = d.samples[0] ?? { x, t }
  const dt = Math.max(16, t - first.t) / 1000
  const velocity = ((x - first.x) / dt) * DEG_PER_PX
  const start = Math.round(d.start / 180)
  const projected = Math.round((current + velocity * 0.28) / 180)
  return { target: Math.max(start - MAX_FLICK_STEPS, Math.min(start + MAX_FLICK_STEPS, projected)), velocity }
}

/** Drag the coin sideways to turn it; let go and it coasts with momentum. */
function useDragSpin(spinner: Spinner, reduceMotion: boolean | null) {
  const drag = useRef<DragState | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    spinner.stop()
    spinner.setSpinning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, start: spinner.angle.get(), moved: false, samples: [{ x: e.clientX, t: e.timeStamp }] }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > TAP_SLOP) d.moved = true
    spinner.angle.set(d.start + dx * DEG_PER_PX)
    d.samples.push({ x: e.clientX, t: e.timeStamp })
    if (d.samples.length > 6) d.samples.shift()
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const current = spinner.angle.get()
    // A tap turns to the next face; a drag coasts on its release speed.
    const { target, velocity } = d.moved ? releaseTarget(d, current, e.clientX, e.timeStamp) : { target: Math.round(current / 180) + 1, velocity: 900 }
    if (reduceMotion) spinner.jumpBy(target)
    else spinner.spinTo(target, { ...DRAG_SPRING, velocity })
  }

  // The browser took the gesture (a vertical scroll that started on the coin): settle on the nearest face.
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const target = Math.round(spinner.angle.get() / 180)
    if (reduceMotion) spinner.jumpBy(target)
    else spinner.spinTo(target, { ...DRAG_SPRING, velocity: 0 })
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}

export function AvatarPicker({ displayName, onSaved }: { displayName: string; onSaved?: (variant: number | null) => void }) {
  const uid = useId()
  const reduceMotion = useReducedMotion()
  const [savedVariant, setSavedVariant] = useState<number | null>(readAvatarVariant)
  const startVariant = savedVariant ?? 0
  const [slots, setSlots] = useState(() => Array.from({ length: SLOT_COUNT }, (_, i) => startVariant + i * 7))
  const [selected, setSelected] = useState(0)
  const [focusIndex, setFocusIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const coinRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([])

  const variant = slots[selected] ?? 0
  const latest = useRef({ variant, selected })
  latest.current = { variant, selected }

  const announce = (v: number) => setAnnouncement(`Avatar: ${createFace(avatarSeed(displayName, v)).description}`)

  const spinner = useSpinner((steps) => {
    const { variant: from, selected: slot } = latest.current
    const next = from + steps
    setSlots((prev) => prev.map((v, i) => (i === slot ? next : v)))
    announce(next)
  })
  const dragHandlers = useDragSpin(spinner, reduceMotion)
  const active = useInView(rootRef)
  const { look, blinkRef } = useLivingEyes(coinRef, active)

  const shownVariant = variant + spinner.step
  const seed = avatarSeed(displayName, shownVariant)

  const shuffle = () => {
    const current = Math.round(spinner.angle.get() / 180)
    const steps = 5 + Math.floor(Math.random() * 4)
    if (reduceMotion) {
      spinner.jumpBy(current + steps)
      return
    }
    spinner.spinTo(current + steps, { ...SHUFFLE_SPRING, velocity: steps * 180 * 1.6 })
  }

  const choose = (index: number) => {
    if (index === selected) return
    if (spinner.spinning) {
      spinner.stop()
      spinner.land()
    }
    setSelected(index)
    setFocusIndex(index)
    announce(slots[index] ?? 0)
  }

  const onSlotKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = { ArrowRight: focusIndex + 1, ArrowDown: focusIndex + 1, ArrowLeft: focusIndex - 1, ArrowUp: focusIndex - 1, Home: 0, End: SLOT_COUNT - 1 }
    const target = moves[e.key]
    if (target === undefined) return
    e.preventDefault()
    const next = (target + SLOT_COUNT) % SLOT_COUNT
    setFocusIndex(next)
    slotRefs.current[next]?.focus()
  }

  const bezelRotate = useTransform(spinner.angle, (a) => `rotate(${round2(a / 15)}deg)`)
  const diceRotate = useTransform(spinner.angle, (a) => `rotate(${round2(a / 4)}deg)`)
  const isSaved = savedVariant === variant && !spinner.spinning

  const save = (next: number | null) => {
    saveAvatarVariant(next)
    setSavedVariant(next)
    onSaved?.(next)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="apick" ref={rootRef}>
        <LayoutGroup id={uid}>
          <div className="apick-stage">
            <div className="apick-bezel" style={{ width: BEZEL, height: BEZEL }}>
              <motion.svg aria-hidden className="apick-ticks" style={{ transform: bezelRotate }} viewBox={`0 0 ${BEZEL} ${BEZEL}`}>
                {TICK_LINES.map((t) => (
                  <line key={t.key} stroke="currentColor" strokeLinecap="round" strokeOpacity={t.long ? 1 : 0.6} strokeWidth={t.long ? 1.5 : 1} x1={t.x1} x2={t.x2} y1={t.y1} y2={t.y2} />
                ))}
              </motion.svg>
              {/* Fixed index mark the bezel turns under. */}
              <div aria-hidden className="apick-index" />
              <Coin
                angle={spinner.angle}
                blinkRef={blinkRef}
                coinRef={coinRef}
                key={selected}
                label={`Selected avatar: ${createFace(seed).description}`}
                layoutId={`face-${selected}`}
                look={look}
                seed={seed}
                spinning={spinner.spinning}
                {...dragHandlers}
              />
            </div>
            <div className="apick-caption">
              <span className="apick-name">{displayName}</span>
              <span className="apick-no">No. {pad3(shownVariant)}</span>
            </div>
          </div>

          <div className="apick-row">
            <div aria-label="Avatar options" className="apick-slots" role="toolbar">
              {slots.map((slotVariant, i) => {
                const isSelected = i === selected
                const slotSeed = avatarSeed(displayName, slotVariant)
                return (
                  <button
                    aria-label={`Option ${i + 1}: ${createFace(slotSeed).description}`}
                    aria-pressed={isSelected}
                    className="apick-slot"
                    key={i}
                    onClick={() => choose(i)}
                    onFocus={() => setFocusIndex(i)}
                    onKeyDown={onSlotKeyDown}
                    ref={(el) => {
                      slotRefs.current[i] = el
                    }}
                    tabIndex={i === focusIndex ? 0 : -1}
                    type="button"
                  >
                    {/* The socket stays put; the face flies in and out of it. */}
                    <span aria-hidden className={cx('apick-socket', isSelected && 'is-empty')} />
                    {isSelected ? (
                      <span aria-hidden className="apick-socket-dot" />
                    ) : (
                      <motion.span className="apick-slot-face" layoutId={`face-${i}`} transition={FLY}>
                        <MorphingFace seed={slotSeed} />
                      </motion.span>
                    )}
                  </button>
                )
              })}
            </div>
            <button aria-label="Shuffle avatar" className="apick-dice" onClick={shuffle} title="Shuffle" type="button">
              <motion.span className="apick-dice-icon" style={{ transform: diceRotate }}>
                <Dices aria-hidden />
              </motion.span>
            </button>
          </div>
        </LayoutGroup>

        <div className="apick-actions">
          <button className="btn btn-primary btn-md" disabled={isSaved} onClick={() => save(variant)} type="button">
            {isSaved ? <Check aria-hidden /> : null}
            {isSaved ? 'This is your avatar' : 'Use this avatar'}
          </button>
          {savedVariant !== null && (
            <button className="btn btn-ghost btn-md" onClick={() => save(null)} type="button">
              <RotateCcw aria-hidden /> Use initials
            </button>
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </MotionConfig>
  )
}
