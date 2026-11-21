import type { RawFrame } from './landmarks'

export type Hint = 'ok' | 'light' | 'body' | 'hands' | 'edge'

export const HINT_TEXT: Record<Hint, string> = {
  ok: 'Cadrage correct',
  light: 'Trop sombre : placez-vous face à une lumière',
  body: 'Montrez la tête et les épaules',
  hands: 'Montrez vos deux mains',
  edge: 'Une main touche le bord : reculez un peu',
}

const MIN_LUMINANCE = 55 // sur 255
const EDGE_MARGIN = 0.02

const inBounds = (pts: { x: number; y: number }[]) =>
  pts.every((p) => p.x > EDGE_MARGIN && p.x < 1 - EDGE_MARGIN && p.y > EDGE_MARGIN && p.y < 1 - EDGE_MARGIN)

/** Premier problème de cadrage rencontré, par ordre de gravité. */
export function assessFraming(raw: RawFrame, luminance: number): Hint {
  if (luminance < MIN_LUMINANCE) return 'light'
  if (!raw.pose || !raw.face) return 'body'
  if (!raw.leftHand || !raw.rightHand) return 'hands'
  if (!inBounds(raw.leftHand) || !inBounds(raw.rightHand)) return 'edge'
  return 'ok'
}

/** Luminance moyenne (0..255) d'une miniature de la vidéo. */
export function measureLuminance(video: HTMLVideoElement, scratch: HTMLCanvasElement): number {
  const w = 32
  const h = 24
  scratch.width = w
  scratch.height = h
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 255
  ctx.drawImage(video, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return sum / (w * h)
}
