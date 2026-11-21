import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import type { Point, RawFrame } from './landmarks'
import type { Delegate, Delegates, FrameTiming } from './perf'

const BASE = `${import.meta.env.BASE_URL}mediapipe/`

/**
 * Le visage (expressions non manuelles : question, négation) évolue bien plus lentement que les
 * mains : on ne le recalcule qu'une image sur deux et on reprend le dernier résultat entre-temps.
 * C'est l'étape la plus économique à alléger pour atteindre 15 i/s sur un téléphone modeste.
 * Surchargeable pour mesurer : ?facestride=1 (chaque image) ou ?facestride=3.
 */
export const DEFAULT_FACE_STRIDE = 2

export interface TrackerOptions {
  faceStride?: number
}

export interface Tracker {
  /** Analyse l'image courante de la vidéo. `nowMs` doit croître à chaque appel. */
  detect(video: HTMLVideoElement, nowMs: number): { raw: RawFrame; timing: FrameTiming }
  /** Calcul réellement utilisé par chaque modèle (le GPU n'est pas disponible partout). */
  delegates: Delegates
  faceStride: number
  close(): void
}

/** Essaie le GPU, retombe sur le CPU si le navigateur ne le supporte pas. */
export async function withDelegate<T>(
  create: (delegate: Delegate) => Promise<T>,
): Promise<{ model: T; delegate: Delegate }> {
  try {
    return { model: await create('GPU'), delegate: 'GPU' }
  } catch {
    return { model: await create('CPU'), delegate: 'CPU' }
  }
}

export async function createTracker({ faceStride = DEFAULT_FACE_STRIDE }: TrackerOptions = {}): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`)
  const stride = Math.max(1, Math.round(faceStride))

  const [h, p, f] = await Promise.all([
    withDelegate((delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
    ),
    withDelegate((delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
    ),
    withDelegate((delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      }),
    ),
  ])
  const hands = h.model
  const pose = p.model
  const face = f.model

  let frameNo = 0
  let lastFace: Point[] | null = null

  return {
    delegates: { hands: h.delegate, pose: p.delegate, face: f.delegate },
    faceStride: stride,
    detect(video, nowMs) {
      const t0 = performance.now()
      const handResult = hands.detectForVideo(video, nowMs)
      const t1 = performance.now()
      const poseResult = pose.detectForVideo(video, nowMs)
      const t2 = performance.now()

      let faceMs: number | null = null
      if (frameNo++ % stride === 0) {
        const faceResult = face.detectForVideo(video, nowMs)
        lastFace = faceResult.faceLandmarks[0] ?? null
        faceMs = performance.now() - t2
      }
      const tEnd = performance.now()

      let leftHand: Point[] | null = null
      let rightHand: Point[] | null = null
      handResult.landmarks.forEach((landmarks, i) => {
        // Left/Right désignent les mains du sujet (image non miroir) : pas d'inversion.
        const label = handResult.handedness[i]?.[0]?.categoryName
        if (label === 'Left') leftHand = landmarks
        else if (label === 'Right') rightHand = landmarks
      })

      return {
        raw: {
          aspect: video.videoWidth / video.videoHeight,
          leftHand,
          rightHand,
          pose: poseResult.landmarks[0] ?? null,
          face: lastFace,
        },
        timing: { total: tEnd - t0, hands: t1 - t0, pose: t2 - t1, face: faceMs },
      }
    },
    close() {
      hands.close()
      pose.close()
      face.close()
    },
  }
}
