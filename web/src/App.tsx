import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { normalizeFrame, type KeypointFrame, type RawFrame } from './lib/landmarks'
import { drawOverlay } from './lib/overlay'
import { HINT_TEXT, assessFraming, measureLuminance, type Hint } from './lib/quality'
import { downloadRecording, finalizeRecording, statsOf, type Recording } from './lib/recording'
import { StreamClient, type ConnectionState, type Gloss, type ServerMessage } from './lib/stream'
import { createTracker, type Tracker } from './lib/tracker'

type Status = 'idle' | 'loading' | 'ready' | 'error'

const LUMINANCE_EVERY = 15 // images entre deux mesures de lumière

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const trackerRef = useRef<Tracker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)

  const recordingRef = useRef<{ startMs: number; frames: KeypointFrame[] } | null>(null)
  const labelRef = useRef('')
  const streamRef2 = useRef<StreamClient | null>(null)
  const streamStartRef = useRef(0)

  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [hint, setHint] = useState<Hint>('body')
  const [fps, setFps] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recordedCount, setRecordedCount] = useState(0)
  const [label, setLabel] = useState('')
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [conn, setConn] = useState<ConnectionState | null>(null)
  const [partial, setPartial] = useState<Gloss[]>([])
  const [sentences, setSentences] = useState<Extract<ServerMessage, { type: 'final' }>[]>([])

  const stopTranslating = useCallback(() => {
    streamRef2.current?.close()
    streamRef2.current = null
    setConn(null)
    setPartial([])
  }, [])

  const stop = useCallback(() => {
    stopTranslating()
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    trackerRef.current?.close()
    trackerRef.current = null
  }, [stopTranslating])

  useEffect(() => stop, [stop])

  const toggleTranslating = () => {
    if (streamRef2.current) return stopTranslating()
    streamStartRef.current = performance.now()
    setSentences([])
    streamRef2.current = new StreamClient({
      onState: setConn,
      onMessage: (msg) => {
        if (msg.type === 'partial') setPartial(msg.glosses)
        else if (msg.type === 'final') {
          setPartial([])
          setSentences((s) => [msg, ...s].slice(0, 20))
        }
      },
    })
  }

  const start = async () => {
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

      trackerRef.current = await createTracker()
      scratchRef.current = document.createElement('canvas')
      setStatus('ready')
      loop()
    } catch (e) {
      stop()
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? "L'accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur."
          : e instanceof Error
            ? e.message
            : String(e),
      )
      setStatus('error')
    }
  }

  const loop = () => {
    let frameCount = 0
    let luminance = 255
    let lastVideoTime = -1
    let fpsWindowStart = performance.now()
    let fpsFrames = 0

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)
      const video = videoRef.current
      const tracker = trackerRef.current
      const overlay = overlayRef.current
      if (!video || !tracker || !overlay || video.readyState < 2 || video.currentTime === lastVideoTime) return
      lastVideoTime = video.currentTime

      const now = performance.now()
      if (overlay.width !== video.videoWidth) {
        overlay.width = video.videoWidth
        overlay.height = video.videoHeight
      }

      const raw: RawFrame = tracker.detect(video, now)
      drawOverlay(overlay, raw)

      if (frameCount % LUMINANCE_EVERY === 0 && scratchRef.current) {
        luminance = measureLuminance(video, scratchRef.current)
      }
      frameCount++
      setHint(assessFraming(raw, luminance))

      const rec = recordingRef.current
      if (rec) {
        rec.frames.push(normalizeFrame(raw, now - rec.startMs))
        if (rec.frames.length % 10 === 0) setRecordedCount(rec.frames.length)
      }
      streamRef2.current?.push(normalizeFrame(raw, now - streamStartRef.current))

      fpsFrames++
      if (now - fpsWindowStart >= 1000) {
        setFps(Math.round((fpsFrames * 1000) / (now - fpsWindowStart)))
        fpsFrames = 0
        fpsWindowStart = now
      }
    }
    tick()
  }

  const toggleRecording = () => {
    if (recordingRef.current) {
      const { frames } = recordingRef.current
      recordingRef.current = null
      setRecording(false)
      if (frames.length === 0) return
      const rec = finalizeRecording({
        id: Date.now().toString(36),
        label: labelRef.current.trim() || 'sans nom',
        createdAt: new Date().toISOString(),
        frames,
      })
      setRecordings((r) => [rec, ...r])
    } else {
      recordingRef.current = { startMs: performance.now(), frames: [] }
      setRecordedCount(0)
      setRecording(true)
    }
  }

  const live = status === 'ready'

  return (
    <main className="app">
      <header>
        <h1>Sikia</h1>
        <p className="tagline">Étape 1 · capture des points clés</p>
      </header>

      <section className="stage" aria-label="Aperçu de la caméra">
        <div className="frame">
          <video ref={videoRef} playsInline muted />
          <canvas ref={overlayRef} />
          {live && (
            <svg className="guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <ellipse cx="50" cy="28" rx="11" ry="15" />
              <path d="M18 100 C18 62 30 52 50 52 C70 52 82 62 82 100" />
            </svg>
          )}
          {live && <span className="fps">{fps} i/s</span>}
          {!live && (
            <div className="placeholder">
              {status === 'loading' ? (
                <p>Chargement des modèles…</p>
              ) : (
                <>
                  <p>
                    La vidéo reste sur votre appareil : seuls des points clés sont analysés, jamais envoyés ici.
                  </p>
                  <button className="primary" onClick={start}>
                    Démarrer la caméra
                  </button>
                </>
              )}
              {status === 'error' && <p className="error">{error}</p>}
            </div>
          )}
        </div>
        {live && (
          <p className={`hint hint-${hint}`} role="status">
            {HINT_TEXT[hint]}
          </p>
        )}
      </section>

      {live && (
        <section className="translate">
          <button className={conn ? 'danger' : 'primary'} onClick={toggleTranslating}>
            {conn ? 'Arrêter la traduction' : 'Traduire'}
          </button>
          {conn === 'connecting' && <p className="muted">Connexion au serveur…</p>}
          {conn === 'closed' && (
            <p className="error">Serveur injoignable : seules les gloses brutes seront disponibles plus tard.</p>
          )}
          {partial.length > 0 && <p className="glosses partial">{partial.map((g) => g.gloss).join(' · ')}</p>}
          <ul className="sentences">
            {sentences.map((s) => (
              <li key={s.sentence_id}>
                {s.text ? (
                  <p className={s.uncertain ? 'text uncertain' : 'text'}>{s.text}</p>
                ) : (
                  <p className="text uncertain">{s.glosses.map((g) => g.gloss).join(' ')}</p>
                )}
                {s.degraded && <small>Traduction indisponible : gloses brutes</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {live && (
        <section className="record">
          <label>
            Signe à enregistrer
            <input
              value={label}
              placeholder="ex. BONJOUR"
              disabled={recording}
              onChange={(e) => {
                setLabel(e.target.value)
                labelRef.current = e.target.value
              }}
            />
          </label>
          <button className={recording ? 'danger' : 'primary'} onClick={toggleRecording}>
            {recording ? `Arrêter (${recordedCount} images)` : 'Enregistrer'}
          </button>
        </section>
      )}

      {recordings.length > 0 && (
        <section className="recordings">
          <h2>Enregistrements</h2>
          <ul>
            {recordings.map((r) => {
              const s = statsOf(r)
              return (
                <li key={r.id}>
                  <div>
                    <strong>{r.label}</strong>
                    <span>
                      {s.frames} images · {s.durationS.toFixed(1)} s · deux mains {Math.round(s.bothHands * 100)} %
                    </span>
                  </div>
                  <button onClick={() => downloadRecording(r)}>Exporter</button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
