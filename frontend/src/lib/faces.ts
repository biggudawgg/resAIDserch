/**
 * Generated faces, from KokonutUI's Avatar Picker (MIT, https://kokonutui.com/docs/inputs/avatar-picker, by
 * @dorianbaffier). Every face is a pure function of a seed string: the seed is hashed into a PRNG that picks continuous
 * feature values and a few colours, so two faces can be blended (that is what makes the live morph possible).
 *
 * Changed from the original: brighter palettes (pastel backgrounds, shirts in the app's categorical colours) and a
 * per-browser store for the viewer's chosen face.
 */

export type RGB = readonly [number, number, number]

const BACKGROUNDS: readonly { name: string; rgb: RGB }[] = [
  { name: 'sky', rgb: [214, 230, 248] },
  { name: 'mint', rgb: [210, 238, 226] },
  { name: 'peach', rgb: [251, 225, 208] },
  { name: 'butter', rgb: [249, 236, 196] },
  { name: 'rose', rgb: [247, 216, 226] },
  { name: 'lavender', rgb: [228, 222, 245] },
]
const SKINS: readonly RGB[] = [
  [246, 233, 222],
  [236, 210, 187],
  [214, 176, 142],
  [176, 128, 96],
  [128, 88, 66],
]
const HAIRS: readonly RGB[] = [
  [39, 37, 42],
  [63, 45, 36],
  [113, 84, 62],
  [150, 72, 40],
  [214, 178, 112],
  [161, 161, 170],
]
const SHIRTS: readonly RGB[] = [
  [42, 120, 214],
  [27, 175, 122],
  [235, 104, 52],
  [217, 154, 30],
  [194, 80, 122],
  [111, 102, 176],
  [28, 27, 24],
]

export const SHAPE_KEYS = [
  'headW',
  'headH',
  'headSquare',
  'chin',
  'hairVolume',
  'hairFringe',
  'hairPart',
  'hairLength',
  'eyeGap',
  'eyeY',
  'eyeRx',
  'eyeRy',
  'browTilt',
  'browLift',
  'browWeight',
  'mouthW',
  'mouthCurve',
  'mouthOpen',
  'nose',
  'glasses',
  'cheeks',
  'shoulders',
] as const

export type ShapeKey = (typeof SHAPE_KEYS)[number]

export interface Face {
  shape: Record<ShapeKey, number>
  bg: RGB
  skin: RGB
  hair: RGB
  shirt: RGB
  /** Plain-language summary, used for screen-reader labels. */
  description: string
}

function hashString(input: string) {
  let h = 2_166_136_261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d_2b_79_f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const round2 = (v: number) => Math.round(v * 100) / 100

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))] as T
}

function describe(shape: Face['shape'], bgName: string) {
  let hair = 'short hair'
  if (shape.hairLength > 0.62) hair = 'long hair'
  else if (shape.hairVolume < 0.22) hair = 'cropped hair'
  let mouth = 'a slight smile'
  if (shape.mouthOpen > 0.5) mouth = 'an open smile'
  else if (shape.mouthCurve > 3.2) mouth = 'a wide smile'
  else if (shape.mouthCurve < 1) mouth = 'a calm expression'
  const face = shape.headSquare > 0.55 ? 'Square face' : 'Round face'
  const glasses = shape.glasses > 0.5 ? ', glasses' : ''
  return `${face}, ${hair}${glasses}, ${mouth}, on ${bgName}`
}

/** Deterministic face for a seed. Same seed, same face. */
export function createFace(seed: string): Face {
  const r = mulberry32(hashString(seed))
  const bg = pick(BACKGROUNDS, r())
  const shape: Face['shape'] = {
    headW: 18 + r() * 5,
    headH: 22 + r() * 4,
    headSquare: r(),
    chin: 0.75 + r() * 0.25,
    hairVolume: r(),
    hairFringe: r(),
    hairPart: r() * 2 - 1,
    hairLength: r() ** 1.6,
    eyeGap: 7.5 + r() * 3,
    eyeY: -2 + r() * 4,
    eyeRx: 1.7 + r() * 0.9,
    eyeRy: 1.9 + r() * 1.4,
    browTilt: -2 + r() * 4,
    browLift: 4.2 + r() * 2,
    browWeight: r() < 0.65 ? 1.3 + r() * 0.8 : 0,
    mouthW: 3.5 + r() * 3,
    mouthCurve: r() * 4.5,
    mouthOpen: r() < 0.3 ? 0.6 + r() * 0.4 : 0,
    nose: r(),
    glasses: r() < 0.25 ? 1 : 0,
    cheeks: r(),
    shoulders: r(),
  }
  for (const key of SHAPE_KEYS) shape[key] = round2(shape[key])
  return { shape, bg: bg.rgb, skin: pick(SKINS, r()), hair: pick(HAIRS, r()), shirt: pick(SHIRTS, r()), description: describe(shape, bg.name) }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const c = (i: 0 | 1 | 2) => Math.max(0, Math.min(255, Math.round(lerp(a[i], b[i], t))))
  return [c(0), c(1), c(2)]
}

export function lerpFace(a: Face, b: Face, t: number): Face {
  const shape = { ...b.shape }
  for (const key of SHAPE_KEYS) shape[key] = lerp(a.shape[key], b.shape[key], t)
  // Colours stop at the target; only shapes may overshoot with the spring.
  const ct = Math.min(1, t)
  return { shape, bg: lerpRgb(a.bg, b.bg, ct), skin: lerpRgb(a.skin, b.skin, ct), hair: lerpRgb(a.hair, b.hair, ct), shirt: lerpRgb(a.shirt, b.shirt, ct), description: b.description }
}

/** The seed string for a name and variant; feed it to `createFace`. */
export function avatarSeed(displayName: string, variant: number) {
  return `${displayName.trim().toLowerCase()}:${variant}`
}

/* ---------------------------------------------------------------- the viewer's chosen face (this browser only) */

const AVATAR_KEY = 'resaidserch.avatar'
const AVATAR_EVENT = 'resaidserch:avatar'

export function readAvatarVariant(): number | null {
  try {
    const v = localStorage.getItem(AVATAR_KEY)
    return v === null ? null : Number.parseInt(v, 10)
  } catch {
    return null
  }
}

export function saveAvatarVariant(variant: number | null) {
  try {
    if (variant === null) localStorage.removeItem(AVATAR_KEY)
    else localStorage.setItem(AVATAR_KEY, String(variant))
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: variant }))
}

/** Subscribe to the chosen face; returns an unsubscribe function. */
export function onAvatarChange(handler: (variant: number | null) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<number | null>).detail)
  window.addEventListener(AVATAR_EVENT, listener)
  return () => window.removeEventListener(AVATAR_EVENT, listener)
}

export const AVATAR_STORAGE_KEY = AVATAR_KEY
