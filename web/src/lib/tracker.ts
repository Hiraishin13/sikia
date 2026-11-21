import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import type { Point, RawFrame } from './landmarks'

const BASE = `${import.meta.env.BASE_URL}mediapipe/`

export interface Tracker {
  /** Analyse l'image courante de la vidéo. `nowMs` doit croître à chaque appel. */
  detect(video: HTMLVideoElement, nowMs: number): RawFrame
  close(): void
}

/** Essaie le GPU, retombe sur le CPU si le navigateur ne le supporte pas. */
async function withDelegate<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU')
  } catch {
    return create('CPU')
  }
}

export async function createTracker(): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`)

  const [hands, pose, face] = await Promise.all([
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

  return {
    detect(video, nowMs) {
      const handResult = hands.detectForVideo(video, nowMs)
      const poseResult = pose.detectForVideo(video, nowMs)
      const faceResult = face.detectForVideo(video, nowMs)

      let leftHand: Point[] | null = null
      let rightHand: Point[] | null = null
      handResult.landmarks.forEach((landmarks, i) => {
        // Left/Right désignent les mains du sujet (image non miroir) : pas d'inversion.
        const label = handResult.handedness[i]?.[0]?.categoryName
        if (label === 'Left') leftHand = landmarks
        else if (label === 'Right') rightHand = landmarks
      })

      return {
        aspect: video.videoWidth / video.videoHeight,
        leftHand,
        rightHand,
        pose: poseResult.landmarks[0] ?? null,
        face: faceResult.faceLandmarks[0] ?? null,
      }
    },
    close() {
      hands.close()
      pose.close()
      face.close()
    },
  }
}
