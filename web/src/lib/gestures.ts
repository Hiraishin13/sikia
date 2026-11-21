import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision'
import type { Point, RawFrame } from './landmarks'
import type { Delegate, FrameTiming } from './perf'
import { withDelegate } from './tracker'

/**
 * Démonstration : le reconnaisseur de gestes de Google (déjà entraîné, gratuit, dans le navigateur).
 * Ce sont 7 gestes de la main, PAS des signes d'une langue des signes.
 */
export type GestureName =
  | 'None'
  | 'Closed_Fist'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Thumb_Down'
  | 'Thumb_Up'
  | 'Victory'
  | 'ILoveYou'

export interface GestureInfo {
  /** Nom du geste, affiché. */
  label: string
  /** Phrase prononcée à voix haute. null : rien n'est dit. Les phrases sont des exemples de démonstration. */
  phrase: string | null
}

export const GESTURES: Record<GestureName, GestureInfo> = {
  None: { label: 'Aucun geste', phrase: null },
  Closed_Fist: { label: 'Poing fermé', phrase: 'Stop.' },
  Open_Palm: { label: 'Main ouverte', phrase: 'Bonjour.' },
  Pointing_Up: { label: 'Index levé', phrase: "Un instant, s'il vous plaît." },
  Thumb_Down: { label: 'Pouce en bas', phrase: "Non, ce n'est pas d'accord." },
  Thumb_Up: { label: 'Pouce en haut', phrase: "Oui, c'est d'accord." },
  Victory: { label: 'Victoire', phrase: 'Paix.' },
  ILoveYou: { label: "Je t'aime", phrase: "Je t'aime." },
}

export function gestureInfo(name: string): GestureInfo {
  return GESTURES[name as GestureName] ?? { label: name, phrase: null }
}

/** Probabilité de chaque geste (entre 0 et 1) pour l'image analysée. */
export type GestureScores = Record<string, number>

export interface GestureFrame {
  /** Mains détectées, pour dessiner les points sur la vidéo. */
  raw: RawFrame
  /** null quand aucune main n'est visible. */
  scores: GestureScores | null
  timing: FrameTiming
}

export interface GestureTracker {
  detect(video: HTMLVideoElement, nowMs: number): GestureFrame
  delegate: Delegate
  close(): void
}

const BASE = `${import.meta.env.BASE_URL}mediapipe/`

export async function createGestureTracker(): Promise<GestureTracker> {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`)
  const { model, delegate } = await withDelegate((d) =>
    GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}models/gesture_recognizer.task`, delegate: d },
      runningMode: 'VIDEO',
      numHands: 2,
      // Toutes les probabilités, pas seulement la meilleure : on les affiche.
      cannedGesturesClassifierOptions: { maxResults: 8, scoreThreshold: 0 },
    }),
  )

  return {
    delegate,
    detect(video, nowMs) {
      const t0 = performance.now()
      const result = model.recognizeForVideo(video, nowMs)
      const total = performance.now() - t0

      let leftHand: Point[] | null = null
      let rightHand: Point[] | null = null
      let best: { score: number; scores: GestureScores } | null = null

      result.landmarks.forEach((landmarks, i) => {
        const label = result.handedness[i]?.[0]?.categoryName
        if (label === 'Left') leftHand = landmarks
        else if (label === 'Right') rightHand = landmarks

        const categories = result.gestures[i] ?? []
        if (categories.length === 0) return
        const scores: GestureScores = {}
        for (const c of categories) scores[c.categoryName] = c.score
        const top = Math.max(...categories.map((c) => c.score))
        // Deux mains : on suit celle dont le geste est le plus net.
        if (!best || top > best.score) best = { score: top, scores }
      })

      return {
        raw: { aspect: video.videoWidth / video.videoHeight, leftHand, rightHand, pose: null, face: null },
        scores: (best as { scores: GestureScores } | null)?.scores ?? null,
        timing: { total, hands: total, pose: 0, face: null },
      }
    },
    close: () => model.close(),
  }
}

// ───────── Lissage dans le temps ─────────

export interface StabilizerOptions {
  /** Poids de l'image courante dans la moyenne glissante (0..1). Plus petit = plus stable, plus lent. */
  alpha?: number
  /** Probabilité lissée minimale pour confirmer un geste (le modèle dépasse rarement 90 %, même sur un geste net). */
  threshold?: number
  /** Nombre d'images de suite où le geste doit rester en tête avant d'être confirmé. */
  holdFrames?: number
  /** Nombre d'images sans main avant d'oublier le geste (il pourra alors être redit). */
  lostFrames?: number
}

export interface StableGesture {
  /** Probabilités lissées. */
  probs: GestureScores
  /** Geste en tête (hors « None » si une main est visible), ou null sans main. */
  top: string | null
  topScore: number
  /** Geste qui vient d'être confirmé à cette image (une seule fois), sinon null. */
  confirmed: string | null
}

/**
 * Une image isolée est instable (le doigt bouge, l'éclairage change) : on moyenne les probabilités,
 * et on ne confirme un geste que s'il reste en tête assez longtemps. La phrase n'est dite qu'une fois
 * par geste, tant qu'il n'a pas été relâché.
 */
export function createStabilizer({
  alpha = 0.4,
  threshold = 0.6,
  holdFrames = 8,
  lostFrames = 10,
}: StabilizerOptions = {}) {
  let probs: GestureScores = {}
  let streakName: string | null = null
  let streak = 0
  let lost = 0
  let announced: string | null = null

  return (scores: GestureScores | null): StableGesture => {
    if (!scores) {
      if (++lost >= lostFrames) {
        probs = {}
        announced = null
      }
      streakName = null
      streak = 0
      return { probs, top: null, topScore: 0, confirmed: null }
    }
    lost = 0

    const next: GestureScores = {}
    for (const name of new Set([...Object.keys(probs), ...Object.keys(scores)])) {
      next[name] = alpha * (scores[name] ?? 0) + (1 - alpha) * (probs[name] ?? 0)
    }
    probs = next

    let top = ''
    let topScore = -1
    for (const [name, p] of Object.entries(probs)) {
      if (p > topScore) {
        top = name
        topScore = p
      }
    }

    streak = top === streakName ? streak + 1 : 1
    streakName = top

    let confirmed: string | null = null
    if (top === 'None') {
      if (streak >= holdFrames) announced = null // main détendue : le même geste pourra être redit
    } else if (topScore >= threshold && streak >= holdFrames && top !== announced) {
      announced = top
      confirmed = top
    }
    return { probs, top, topScore, confirmed }
  }
}
