import { useCallback, useEffect, useRef, useState } from 'react'
import { createGestureTracker, type GestureFrame, type GestureTracker } from '../lib/gestures'
import type { RawFrame } from '../lib/landmarks'
import { drawOverlay } from '../lib/overlay'
import { summarize, type Delegates, type FrameTiming, type PerfStats } from '../lib/perf'
import { assessFraming, createHintSmoother, measureLuminance, type Hint } from '../lib/quality'
import { DEFAULT_FACE_STRIDE, createTracker, type Tracker } from '../lib/tracker'

export type CaptureStatus = 'idle' | 'loading' | 'ready' | 'error'
export type GestureStatus = 'idle' | 'loading' | 'ready' | 'error'
/** signs : mains + corps + visage pour les signes. gestures : le reconnaisseur de gestes de Google seul. */
export type CaptureMode = 'signs' | 'gestures'
export type FrameListener = (raw: RawFrame, nowMs: number) => void
export type GestureListener = (frame: GestureFrame) => void

const LUMINANCE_EVERY = 15 // images entre deux mesures de lumière
const PERF_WINDOW_MS = 5000 // fenêtre glissante des mesures de performance (assez longue pour un appareil lent)

function faceStrideFromUrl(): number {
  const raw = new URLSearchParams(location.search).get('facestride')
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_FACE_STRIDE
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_FACE_STRIDE
}

export interface PerfSnapshot {
  stats: PerfStats
  delegates: Delegates
  faceStride: number
  video: string
}

/**
 * Caméra + MediaPipe. Les écrans s'abonnent aux images détectées avec `subscribe` (signes) ou
 * `subscribeGestures` (gestes) ; ce hook ne sait rien de la traduction ni de l'enregistrement.
 * Un seul mode tourne à la fois : le mode inactif ne consomme rien.
 */
export function useCapture(mode: CaptureMode = 'signs') {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const trackerRef = useRef<Tracker | null>(null)
  const gestureRef = useRef<GestureTracker | null>(null)
  // Chargements paresseux mémorisés : une promesse rejetée reste rejetée (pas de nouvelle tentative à chaque image).
  const signsLoad = useRef<Promise<void> | null>(null)
  const gestureLoad = useRef<Promise<void> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const modeRef = useRef(mode)
  const listeners = useRef(new Set<FrameListener>())
  const gestureListeners = useRef(new Set<GestureListener>())

  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [gestureStatus, setGestureStatus] = useState<GestureStatus>('idle')
  const [error, setError] = useState('')
  const [hint, setHint] = useState<Hint>('body')
  const [fps, setFps] = useState(0)
  const [perf, setPerf] = useState<PerfSnapshot | null>(null)
  // Format réel de la vidéo : un téléphone tenu en portrait renvoie souvent du 3:4, pas du 4:3.
  const [aspect, setAspect] = useState(4 / 3)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const subscribe = useCallback((fn: FrameListener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const subscribeGestures = useCallback((fn: GestureListener) => {
    gestureListeners.current.add(fn)
    return () => {
      gestureListeners.current.delete(fn)
    }
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    trackerRef.current?.close()
    trackerRef.current = null
    gestureRef.current?.close()
    gestureRef.current = null
    signsLoad.current = null
    gestureLoad.current = null
  }, [])

  useEffect(() => stop, [stop])

  const loadSigns = useCallback((): Promise<void> => {
    if (!signsLoad.current) {
      signsLoad.current = createTracker({ faceStride: faceStrideFromUrl() }).then((t) => {
        trackerRef.current = t
      })
    }
    return signsLoad.current
  }, [])

  /** Le reconnaisseur de gestes (8 Mo) ne se charge que la première fois qu'on en a besoin. */
  const loadGestures = useCallback((): Promise<void> => {
    if (!gestureLoad.current) {
      setGestureStatus('loading')
      gestureLoad.current = createGestureTracker().then(
        (t) => {
          gestureRef.current = t
          setGestureStatus('ready')
        },
        (e) => {
          setGestureStatus('error')
          throw e
        },
      )
    }
    return gestureLoad.current
  }, [])

  const runLoop = useCallback(() => {
    const scratch = document.createElement('canvas')
    const smooth = createHintSmoother()
    let frameCount = 0
    let luminance = 255
    let lastVideoTime = -1
    let fpsStart = performance.now()
    let fpsFrames = 0
    const samples: { at: number; timing: FrameTiming }[] = []

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      const video = videoRef.current
      const overlay = overlayRef.current
      if (!video || !overlay || video.readyState < 2 || video.currentTime === lastVideoTime) return

      const gestureMode = modeRef.current === 'gestures'
      const tracker = trackerRef.current
      const gestureTracker = gestureRef.current
      if (gestureMode ? !gestureTracker : !tracker) {
        const failed = () => {
          setError("Le modèle n'a pas pu se charger. Vérifiez la connexion, puis réessayez.")
          setStatus('error')
        }
        void (gestureMode ? loadGestures() : loadSigns()).catch(failed)
        return
      }
      lastVideoTime = video.currentTime

      const now = performance.now()
      if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
        overlay.width = video.videoWidth
        overlay.height = video.videoHeight
      }

      let timing: FrameTiming
      let delegates: Delegates
      let faceStride = 1

      if (gestureMode && gestureTracker) {
        const frame = gestureTracker.detect(video, now)
        drawOverlay(overlay, frame.raw)
        setHint(smooth(frame.raw.leftHand || frame.raw.rightHand ? 'ok' : 'hand'))
        gestureListeners.current.forEach((fn) => fn(frame))
        timing = frame.timing
        delegates = { hands: gestureTracker.delegate, pose: gestureTracker.delegate, face: gestureTracker.delegate }
      } else if (tracker) {
        const detected = tracker.detect(video, now)
        drawOverlay(overlay, detected.raw)
        if (frameCount++ % LUMINANCE_EVERY === 0) luminance = measureLuminance(video, scratch)
        setHint(smooth(assessFraming(detected.raw, luminance)))
        listeners.current.forEach((fn) => fn(detected.raw, now))
        timing = detected.timing
        delegates = tracker.delegates
        faceStride = tracker.faceStride
      } else {
        return
      }

      fpsFrames++
      samples.push({ at: now, timing })
      while (samples.length > 0 && now - samples[0].at > PERF_WINDOW_MS) samples.shift()

      if (now - fpsStart >= 1000) {
        setFps(Math.round((fpsFrames * 1000) / (now - fpsStart)))
        fpsFrames = 0
        fpsStart = now
        if (samples.length >= 2) {
          const span = Math.min(PERF_WINDOW_MS, now - samples[0].at)
          const stats = summarize(samples.map((s) => s.timing), Math.max(span, 1))
          if (stats) setPerf({ stats, delegates, faceStride, video: `${video.videoWidth}×${video.videoHeight}` })
        }
      }
    }
    tick()
  }, [loadGestures, loadSigns])

  const start = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      const syncAspect = () => {
        if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight)
      }
      syncAspect()
      video.addEventListener('resize', syncAspect) // rotation de l'appareil

      // Seul le modèle du mode courant est chargé tout de suite ; l'autre l'est à la demande.
      await (modeRef.current === 'signs' ? loadSigns() : loadGestures())
      setStatus('ready')
      runLoop()
    } catch (e) {
      stop()
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? "L'accès à la caméra est refusé. Autorisez-le dans les réglages du navigateur, puis réessayez."
          : e instanceof DOMException && e.name === 'NotFoundError'
            ? "Aucune caméra n'a été trouvée sur cet appareil."
            : "La caméra n'a pas pu démarrer.",
      )
      setStatus('error')
    }
  }, [loadGestures, loadSigns, runLoop, stop])

  return { videoRef, overlayRef, status, gestureStatus, error, hint, fps, aspect, perf, start, subscribe, subscribeGestures }
}
