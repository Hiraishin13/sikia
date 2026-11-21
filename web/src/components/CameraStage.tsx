import type { CSSProperties, RefObject } from 'react'
import type { CaptureStatus } from '../hooks/useCapture'
import { HINT_TEXT, type Hint } from '../lib/quality'
import { Icon, type IconName } from './Icon'

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLCanvasElement | null>
  status: CaptureStatus
  error: string
  hint: Hint
  fps: number
  aspect: number
  debug: boolean
  /** En mode gestes, pas de silhouette de cadrage : seule la main compte. */
  showGuide?: boolean
  onStart: () => void
}

const HINT_ICON: Record<Hint, IconName> = {
  ok: 'check',
  light: 'sun',
  body: 'person',
  hands: 'hand',
  hand: 'hand',
  edge: 'alert',
}

export function CameraStage({ videoRef, overlayRef, status, error, hint, fps, aspect, debug, showGuide = true, onStart }: Props) {
  const ready = status === 'ready'
  return (
    <section
      className="camera"
      aria-label="Caméra"
      style={{ '--cam-aspect': aspect } as CSSProperties}
    >
      <div className="camera-frame">
        <video ref={videoRef} playsInline muted aria-hidden />
        <canvas ref={overlayRef} aria-hidden />

        {/* Le guide n'apparaît que si le cadrage est à corriger : il disparaît quand tout va bien. */}
        {ready && showGuide && (
          <svg
            className={`camera-guide${hint === 'ok' ? ' is-hidden' : ''}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <ellipse cx="50" cy="30" rx="12" ry="16" />
            <path d="M14 100C14 66 28 56 50 56s36 10 36 44" />
          </svg>
        )}

        {ready && (
          <span className="camera-chip">
            <span className="dot" aria-hidden /> Caméra active
          </span>
        )}
        {ready && debug && <span className="camera-debug">{fps} i/s</span>}

        {!ready && (
          <div className="camera-empty">
            {status === 'loading' ? (
              <p>Préparation de la caméra…</p>
            ) : (
              <>
                <p className="camera-empty-title">Caméra éteinte</p>
                <button className="btn btn-primary" onClick={onStart}>
                  Activer la caméra
                </button>
                <p className="camera-empty-note">
                  <Icon name="lock" size={16} /> La vidéo reste sur votre appareil.
                </p>
              </>
            )}
            {status === 'error' && (
              <p className="camera-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {ready && (
        <p className={`framing framing-${hint === 'ok' ? 'ok' : 'warn'}`} role="status">
          <span className="framing-icon">
            <Icon name={HINT_ICON[hint]} />
          </span>
          {HINT_TEXT[hint]}
        </p>
      )}
    </section>
  )
}
