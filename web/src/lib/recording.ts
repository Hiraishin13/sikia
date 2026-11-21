import {
  LAYOUT,
  QUANT_SCALE,
  VALUES_PER_FRAME,
  fillShortGaps,
  quantize16,
  type KeypointFrame,
} from './landmarks'

export interface Recording {
  id: string
  /** Signe ou phrase enregistrée, saisi par l'utilisateur. */
  label: string
  createdAt: string
  frames: KeypointFrame[]
}

export interface RecordingStats {
  frames: number
  durationS: number
  /** Part des images où les deux mains sont détectées. */
  bothHands: number
}

export function finalizeRecording(rec: Recording): Recording {
  fillShortGaps(rec.frames)
  return rec
}

export function statsOf(rec: Recording): RecordingStats {
  const n = rec.frames.length
  const both = rec.frames.filter((f) => f.leftHand && f.rightHand).length
  const durationS = n > 1 ? (rec.frames[n - 1].t - rec.frames[0].t) / 1000 : 0
  return { frames: n, durationS, bothHands: n ? both / n : 0 }
}

/** Format d'échange avec le pipeline d'entraînement (voir docs/keypoints-format.md). */
export function serialize(rec: Recording) {
  return {
    version: 1,
    label: rec.label,
    createdAt: rec.createdAt,
    layout: {
      valuesPerFrame: VALUES_PER_FRAME,
      quantScale: QUANT_SCALE,
      segments: LAYOUT,
    },
    frames: rec.frames.map((f) => ({
      t: Math.round(f.t),
      flags: [f.valid, f.leftHand, f.rightHand, f.face].map(Number),
      q: Array.from(quantize16(f.data)),
    })),
  }
}

export function downloadRecording(rec: Recording): void {
  const blob = new Blob([JSON.stringify(serialize(rec))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safe = rec.label.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'enregistrement'
  a.download = `${safe}-${rec.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}
