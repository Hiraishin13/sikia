import { useCallback, useEffect, useRef, useState } from 'react'
import type { RawFrame } from '../lib/landmarks'
import { drawOverlay } from '../lib/overlay'
import { assessFraming, createHintSmoother, measureLuminance, type Hint } from '../lib/quality'
import { createTracker, type Tracker } from '../lib/tracker'

export type CaptureStatus = 'idle' | 'loading' | 'ready' | 'error'
export type FrameListener = (raw: RawFrame, nowMs: number) => void

const LUMINANCE_EVERY = 15 // images entre deux mesures de lumière

/**
 * Caméra + MediaPipe. Les écrans s'abonnent aux images détectées avec `subscribe` ;
 * ce hook ne sait rien de la traduction ni de l'enregistrement.
 */
export function useCapture() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const trackerRef = useRef<Tracker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const listeners = useRef(new Set<FrameListener>())

  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [error, setError] = useState('')
  const [hint, setHint] = useState<Hint>('body')
  const [fps, setFps] = useState(0)
  // Format réel de la vidéo : un téléphone tenu en portrait renvoie souvent du 3:4, pas du 4:3.
  const [aspect, setAspect] = useState(4 / 3)

  const subscribe = useCallback((fn: FrameListener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    trackerRef.current?.close()
    trackerRef.current = null
  }, [])

  useEffect(() => stop, [stop])

  const runLoop = useCallback(() => {
    const scratch = document.createElement('canvas')
    const smooth = createHintSmoother()
    let frameCount = 0
    let luminance = 255
    let lastVideoTime = -1
    let fpsStart = performance.now()
    let fpsFrames = 0

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      const video = videoRef.current
      const tracker = trackerRef.current
      const overlay = overlayRef.current
      if (!video || !tracker || !overlay || video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime

      const now = performance.now()
      if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
        overlay.width = video.videoWidth
        overlay.height = video.videoHeight
      }

      const raw = tracker.detect(video, now)
      drawOverlay(overlay, raw)

      if (frameCount++ % LUMINANCE_EVERY === 0) luminance = measureLuminance(video, scratch)
      setHint(smooth(assessFraming(raw, luminance)))

      listeners.current.forEach((fn) => fn(raw, now))

      fpsFrames++
      if (now - fpsStart >= 1000) {
        setFps(Math.round((fpsFrames * 1000) / (now - fpsStart)))
        fpsFrames = 0
        fpsStart = now
      }
    }
    tick()
  }, [])

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

      trackerRef.current = await createTracker()
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
  }, [runLoop, stop])

  return { videoRef, overlayRef, status, error, hint, fps, aspect, start, subscribe }
}
