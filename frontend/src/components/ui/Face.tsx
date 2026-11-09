/**
 * Face drawing and morph, from KokonutUI's Avatar Picker (MIT, https://kokonutui.com/docs/inputs/avatar-picker,
 * by @dorianbaffier), ported to this app. Face generation lives in lib/faces.ts.
 */
import { type RefObject, useEffect, useRef, useState } from 'react'
import { animate, type MotionValue, motion, useReducedMotion } from 'motion/react'
import { createFace, type Face, lerpFace, round2 as n, type RGB } from '../../lib/faces'

const INK = '#1c1b18'

const rgb = (c: RGB, k = 1) => `rgb(${Math.round(c[0] * k)} ${Math.round(c[1] * k)} ${Math.round(c[2] * k)})`

/** Rounded blob: `square` blends between an ellipse and a squircle. */
function blobPath(cx: number, cy: number, w: number, top: number, bottom: number, square: number, chin = 1) {
  const k = 0.552 + square * 0.28
  const kb = k * chin
  return [
    `M${n(cx)} ${n(cy - top)}`,
    `C${n(cx + k * w)} ${n(cy - top)} ${n(cx + w)} ${n(cy - k * top)} ${n(cx + w)} ${n(cy)}`,
    `C${n(cx + w)} ${n(cy + kb * bottom)} ${n(cx + kb * w)} ${n(cy + bottom)} ${n(cx)} ${n(cy + bottom)}`,
    `C${n(cx - kb * w)} ${n(cy + bottom)} ${n(cx - w)} ${n(cy + kb * bottom)} ${n(cx - w)} ${n(cy)}`,
    `C${n(cx - w)} ${n(cy - k * top)} ${n(cx - k * w)} ${n(cy - top)} ${n(cx)} ${n(cy - top)}Z`,
  ].join('')
}

function hairFrontPath(s: Face['shape'], cx: number, cy: number) {
  const w = s.headW
  const h = s.headH
  const v = s.hairVolume
  const temple = cy - h * 0.12
  const crown = cy - h - 1.5 - v * 4
  const side = w + 1.5 + v * 2.5
  const k = 0.552 + s.headSquare * 0.28
  const fringeY = cy - h * (0.66 - s.hairFringe * 0.36)
  const partX = cx + s.hairPart * w * 0.55
  return [
    `M${n(cx - side)} ${n(temple)}`,
    `C${n(cx - side)} ${n(cy - h * k - v * 3)} ${n(cx - k * side)} ${n(crown)} ${n(cx)} ${n(crown)}`,
    `C${n(cx + k * side)} ${n(crown)} ${n(cx + side)} ${n(cy - h * k - v * 3)} ${n(cx + side)} ${n(temple)}`,
    `L${n(cx + w - 1)} ${n(temple)}`,
    `Q${n(cx + w * 0.75)} ${n(fringeY + 1 - s.hairPart * 5)} ${n(partX)} ${n(fringeY - 2.5)}`,
    `Q${n(cx - w * 0.75)} ${n(fringeY + 1 + s.hairPart * 5)} ${n(cx - w + 1)} ${n(temple)}Z`,
  ].join('')
}

function mouthPath(s: Face['shape'], cx: number, y: number) {
  const curve = s.mouthCurve * 2
  const open = s.mouthOpen * 5
  return [`M${n(cx - s.mouthW)} ${n(y)}`, `Q${n(cx)} ${n(y + curve)} ${n(cx + s.mouthW)} ${n(y)}`, `Q${n(cx)} ${n(y + curve + open)} ${n(cx - s.mouthW)} ${n(y)}Z`].join('')
}

interface FaceArtProps {
  face: Face
  /** Pointer-follow offset for the eyes, in face units. */
  look?: { x: MotionValue<number>; y: MotionValue<number> }
  blinkRef?: RefObject<SVGGElement>
  className?: string
}

/** The face itself: one SVG, 100×100 units. */
export function FaceArt({ face, look, blinkRef, className }: FaceArtProps) {
  const s = face.shape
  const cx = 50
  const cy = 50
  const eyeY = cy + s.eyeY
  const mouthY = cy + s.headH * 0.5
  const glassR = Math.max(s.eyeRx, s.eyeRy) + 3.2
  const neckTop = cy + s.headH - 6
  const shoulderTop = cy + s.headH + 3
  const sw = 30 + s.shoulders * 8

  return (
    <svg aria-hidden className={className ? `face-art ${className}` : 'face-art'} viewBox="12 14 76 76">
      <rect fill={rgb(face.bg)} height="100" width="100" />
      {/* Long hair sits behind the head. */}
      <path
        d={blobPath(cx, cy - s.headH * 0.15, s.headW + 1 + s.hairVolume * 2.5, s.headH * 0.85 + s.hairVolume * 4, s.headH * 0.15 + s.hairLength * (s.headH + 14), s.headSquare * 0.6)}
        fill={rgb(face.hair, 0.9)}
      />
      <path
        d={`M${n(cx - sw)} 100C${n(cx - sw)} ${n(shoulderTop + 6)} ${n(cx - sw * 0.55)} ${n(shoulderTop)} ${cx} ${n(shoulderTop)}C${n(cx + sw * 0.55)} ${n(shoulderTop)} ${n(cx + sw)} ${n(shoulderTop + 6)} ${n(cx + sw)} 100Z`}
        fill={rgb(face.shirt)}
      />
      <rect fill={rgb(face.skin, 0.9)} height={n(shoulderTop - neckTop + 3)} rx="3" width="12" x={cx - 6} y={n(neckTop)} />
      <ellipse cx={n(cx - s.headW)} cy={n(cy + 2)} fill={rgb(face.skin, 0.95)} rx="3" ry="4.5" />
      <ellipse cx={n(cx + s.headW)} cy={n(cy + 2)} fill={rgb(face.skin, 0.95)} rx="3" ry="4.5" />
      <path d={blobPath(cx, cy, s.headW, s.headH, s.headH, s.headSquare, s.chin)} fill={rgb(face.skin)} />
      <path d={hairFrontPath(s, cx, cy)} fill={rgb(face.hair)} />
      <g fill="#e2556b" opacity={n(0.12 * s.cheeks)}>
        <circle cx={n(cx - s.eyeGap - 3)} cy={n(eyeY + 7)} r="3.4" />
        <circle cx={n(cx + s.eyeGap + 3)} cy={n(eyeY + 7)} r="3.4" />
      </g>
      <g stroke={INK} strokeLinecap="round" strokeOpacity="0.85" strokeWidth={n(Math.max(0, s.browWeight))}>
        <path d={`M${n(cx - s.eyeGap - 3.2)} ${n(eyeY - s.browLift + s.browTilt)}L${n(cx - s.eyeGap + 3.2)} ${n(eyeY - s.browLift - s.browTilt)}`} />
        <path d={`M${n(cx + s.eyeGap - 3.2)} ${n(eyeY - s.browLift - s.browTilt)}L${n(cx + s.eyeGap + 3.2)} ${n(eyeY - s.browLift + s.browTilt)}`} />
      </g>
      <motion.g style={look ? { x: look.x, y: look.y } : undefined}>
        <g className="face-blink" ref={blinkRef} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <ellipse cx={n(cx - s.eyeGap)} cy={n(eyeY)} fill={INK} rx={n(s.eyeRx)} ry={n(s.eyeRy)} />
          <ellipse cx={n(cx + s.eyeGap)} cy={n(eyeY)} fill={INK} rx={n(s.eyeRx)} ry={n(s.eyeRy)} />
        </g>
      </motion.g>
      <path
        d={`M${n(cx - 1.5 - s.nose)} ${n(eyeY + 8 + s.nose * 1.5)}Q${cx} ${n(eyeY + 9.5 + s.nose * 1.5)} ${n(cx + 1.5 + s.nose)} ${n(eyeY + 8 + s.nose * 1.5)}`}
        fill="none"
        stroke={INK}
        strokeLinecap="round"
        strokeOpacity="0.35"
        strokeWidth="1.2"
      />
      <path d={mouthPath(s, cx, mouthY)} fill={INK} stroke={INK} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <g fill="none" opacity={n(Math.max(0, Math.min(1, s.glasses)))} stroke={INK} strokeWidth="1.2">
        <circle cx={n(cx - s.eyeGap)} cy={n(eyeY)} r={n(glassR)} />
        <circle cx={n(cx + s.eyeGap)} cy={n(eyeY)} r={n(glassR)} />
        <path d={`M${n(cx - s.eyeGap + glassR)} ${n(eyeY)}Q${cx} ${n(eyeY - 2)} ${n(cx + s.eyeGap - glassR)} ${n(eyeY)}`} />
      </g>
    </svg>
  )
}

const MORPH = { type: 'spring', bounce: 0.22, visualDuration: 0.42 } as const

/** Renders the face for `seed` and, when the seed changes, eases every feature to the new values instead of crossfading. */
export function MorphingFace({ seed, morph = true, ...rest }: Omit<FaceArtProps, 'face'> & { seed: string; morph?: boolean }) {
  const [face, setFace] = useState(() => createFace(seed))
  const shownRef = useRef(face)
  // The seed fully on screen, or null mid-morph; skips a no-op morph on mount and after a spin lands.
  const settledRef = useRef<string | null>(seed)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (settledRef.current === seed) return
    const target = createFace(seed)
    if (!morph || reduceMotion) {
      shownRef.current = target
      settledRef.current = seed
      setFace(target)
      return
    }
    const from = shownRef.current
    settledRef.current = null
    const controls = animate(0, 1, {
      ...MORPH,
      onUpdate: (t) => {
        const next = lerpFace(from, target, t)
        shownRef.current = next
        setFace(next)
      },
      onComplete: () => {
        settledRef.current = seed
      },
    })
    return () => controls.stop()
  }, [seed, morph, reduceMotion])

  return <FaceArt face={face} {...rest} />
}
