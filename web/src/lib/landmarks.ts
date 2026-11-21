/**
 * Format des points clés Sikia (voir docs/keypoints-format.md).
 *
 * Une image = un vecteur Float32 de VALUES_PER_FRAME nombres, dans cet ordre :
 *   [main gauche 21×3][main droite 21×3][pose 7×3][visage 42×3]
 * Coordonnées recentrées sur le milieu des épaules et divisées par la largeur
 * des épaules (la taille de la personne et la distance à la caméra s'annulent).
 */

export interface Point {
  x: number
  y: number
  z: number
  visibility?: number
}

export const HAND_POINTS = 21

/** Pose : nez, épaules (G/D), coudes (G/D), poignets (G/D). Indices MediaPipe Pose. */
export const POSE_INDICES = [0, 11, 12, 13, 14, 15, 16] as const
const POSE_LEFT_SHOULDER = 11
const POSE_RIGHT_SHOULDER = 12

/** Visage : ~40 points autour des lèvres, sourcils et yeux. Indices MediaPipe Face Mesh. */
export const FACE_INDICES = [
  // lèvres (contour extérieur)
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
  // sourcils
  70, 63, 105, 66, 107, 300, 293, 334, 296, 336,
  // yeux
  33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
] as const

export const LAYOUT = {
  leftHand: { offset: 0, points: HAND_POINTS },
  rightHand: { offset: HAND_POINTS * 3, points: HAND_POINTS },
  pose: { offset: HAND_POINTS * 6, points: POSE_INDICES.length },
  face: { offset: HAND_POINTS * 6 + POSE_INDICES.length * 3, points: FACE_INDICES.length },
} as const

export const VALUES_PER_FRAME = LAYOUT.face.offset + FACE_INDICES.length * 3

/** Détection brute d'une image, en coordonnées normalisées MediaPipe (0..1). */
export interface RawFrame {
  /** Rapport largeur/hauteur de la vidéo, pour redonner des proportions réelles à x et y. */
  aspect: number
  leftHand: Point[] | null
  rightHand: Point[] | null
  pose: Point[] | null
  face: Point[] | null
}

export interface KeypointFrame {
  /** Instant de l'image, en ms depuis le début de l'enregistrement. */
  t: number
  data: Float32Array
  /** Faux si les épaules sont introuvables : l'image ne peut pas être normalisée. */
  valid: boolean
  leftHand: boolean
  rightHand: boolean
  face: boolean
}

const MIN_SHOULDER_VISIBILITY = 0.5

export function emptyFrame(t: number): KeypointFrame {
  return {
    t,
    data: new Float32Array(VALUES_PER_FRAME),
    valid: false,
    leftHand: false,
    rightHand: false,
    face: false,
  }
}

export function normalizeFrame(raw: RawFrame, t: number): KeypointFrame {
  const frame = emptyFrame(t)
  const pose = raw.pose
  const ls = pose?.[POSE_LEFT_SHOULDER]
  const rs = pose?.[POSE_RIGHT_SHOULDER]
  if (!pose || !ls || !rs) return frame
  if ((ls.visibility ?? 1) < MIN_SHOULDER_VISIBILITY || (rs.visibility ?? 1) < MIN_SHOULDER_VISIBILITY) {
    return frame
  }

  // x et y sont normalisés par la largeur / la hauteur de l'image : on repasse en
  // unités isotropes (largeur = 1) avant de mesurer la largeur des épaules.
  const a = raw.aspect
  const cx = (ls.x + rs.x) / 2
  const cy = (ls.y + rs.y) / 2
  const cz = (ls.z + rs.z) / 2
  const shoulderWidth = Math.hypot((ls.x - rs.x) * a, ls.y - rs.y)
  if (shoulderWidth < 1e-4) return frame
  const k = 1 / shoulderWidth

  const write = (offset: number, p: Point) => {
    frame.data[offset] = (p.x - cx) * a * k
    frame.data[offset + 1] = (p.y - cy) * k
    frame.data[offset + 2] = (p.z - cz) * a * k
  }

  frame.valid = true

  POSE_INDICES.forEach((idx, i) => {
    const p = pose[idx]
    if (p) write(LAYOUT.pose.offset + i * 3, p)
  })

  const writeHand = (pts: Point[] | null, offset: number): boolean => {
    if (!pts || pts.length < HAND_POINTS) return false
    for (let i = 0; i < HAND_POINTS; i++) write(offset + i * 3, pts[i])
    return true
  }
  frame.leftHand = writeHand(raw.leftHand, LAYOUT.leftHand.offset)
  frame.rightHand = writeHand(raw.rightHand, LAYOUT.rightHand.offset)

  if (raw.face) {
    let ok = true
    FACE_INDICES.forEach((idx, i) => {
      const p = raw.face![idx]
      if (!p) ok = false
      else write(LAYOUT.face.offset + i * 3, p)
    })
    frame.face = ok
  }

  return frame
}

type HandKey = 'leftHand' | 'rightHand'

/**
 * Comble par interpolation linéaire les trous courts (≤ maxGap images) d'une main
 * entre deux images où elle est détectée. Les trous plus longs restent vides :
 * la main est vraiment sortie du champ. Modifie `frames` sur place.
 */
export function fillShortGaps(frames: KeypointFrame[], maxGap = 4): void {
  for (const key of ['leftHand', 'rightHand'] as HandKey[]) {
    const { offset, points } = LAYOUT[key]
    const len = points * 3
    let lastPresent = -1
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i][key]) continue
      const gap = i - lastPresent - 1
      if (lastPresent >= 0 && gap > 0 && gap <= maxGap) {
        const from = frames[lastPresent].data
        const to = frames[i].data
        for (let g = 1; g <= gap; g++) {
          const w = g / (gap + 1)
          const f = frames[lastPresent + g]
          if (!f.valid) continue
          for (let j = 0; j < len; j++) {
            f.data[offset + j] = from[offset + j] * (1 - w) + to[offset + j] * w
          }
          f[key] = true
        }
      }
      lastPresent = i
    }
  }
}

/** Les coordonnées normalisées restent dans ±8 largeurs d'épaules : int16 = 1/4096 de précision. */
export const QUANT_SCALE = 4096

export function quantize16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(data[i] * QUANT_SCALE)))
  }
  return out
}

export function dequantize16(data: Int16Array): Float32Array {
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] / QUANT_SCALE
  return out
}
