/** Mesure des performances de suivi (cible du MVP : ≥ 15 images/s sur un téléphone milieu de gamme). */

export const TARGET_FPS = 15

/** Durée de traitement d'une image, par étape, en ms. `face` vaut null quand l'étape a été sautée. */
export interface FrameTiming {
  total: number
  hands: number
  pose: number
  face: number | null
}

export interface PerfStats {
  frames: number
  fps: number
  /** Temps de traitement d'une image (médiane et pire 5 %), en ms. */
  medianMs: number
  p95Ms: number
  stages: { hands: number; pose: number; face: number }
}

export type Delegate = 'GPU' | 'CPU'
export interface Delegates {
  hands: Delegate
  pose: Delegate
  face: Delegate
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

/** Résume une fenêtre d'images traitées pendant `windowMs`. */
export function summarize(samples: FrameTiming[], windowMs: number): PerfStats | null {
  if (samples.length === 0) return null
  const faces = samples.map((s) => s.face).filter((f): f is number => f !== null)
  return {
    frames: samples.length,
    fps: (samples.length * 1000) / windowMs,
    medianMs: percentile(samples.map((s) => s.total), 50),
    p95Ms: percentile(samples.map((s) => s.total), 95),
    stages: {
      hands: percentile(samples.map((s) => s.hands), 50),
      pose: percentile(samples.map((s) => s.pose), 50),
      face: percentile(faces, 50),
    },
  }
}

export function meetsTarget(stats: PerfStats): boolean {
  return stats.fps >= TARGET_FPS
}

/** Étape la plus lente : celle à optimiser en premier. */
export function slowestStage(stats: PerfStats): 'hands' | 'pose' | 'face' {
  const { hands, pose, face } = stats.stages
  if (hands >= pose && hands >= face) return 'hands'
  return pose >= face ? 'pose' : 'face'
}

export interface DeviceInfo {
  userAgent: string
  cores: number | null
  memoryGb: number | null
  video: string
}

/** Rapport texte à coller dans un message ou un ticket. */
export function formatReport(stats: PerfStats, delegates: Delegates, device: DeviceInfo, faceStride: number): string {
  const ms = (n: number) => `${n.toFixed(1)} ms`
  return [
    `Sikia — mesure de performance (${new Date().toISOString()})`,
    `Résultat : ${stats.fps.toFixed(1)} i/s — cible ${TARGET_FPS} i/s : ${meetsTarget(stats) ? 'ATTEINTE' : 'NON atteinte'}`,
    `Traitement par image : médiane ${ms(stats.medianMs)}, pire 5 % ${ms(stats.p95Ms)}`,
    `Étapes (médiane) : mains ${ms(stats.stages.hands)}, pose ${ms(stats.stages.pose)}, visage ${ms(stats.stages.face)} (1 image sur ${faceStride})`,
    `Calcul : mains ${delegates.hands}, pose ${delegates.pose}, visage ${delegates.face}`,
    `Vidéo : ${device.video}`,
    `Appareil : ${device.cores ?? '?'} cœurs, ${device.memoryGb ?? '?'} Go (indicatif), ${device.userAgent}`,
    `Images mesurées : ${stats.frames}`,
  ].join('\n')
}
