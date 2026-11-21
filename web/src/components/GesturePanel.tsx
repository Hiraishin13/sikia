import { useEffect, useRef, useState } from 'react'
import type { GestureListener, GestureStatus } from '../hooks/useCapture'
import { createStabilizer, gestureInfo, type StableGesture } from '../lib/gestures'
import { pickVoice, speak, speechSupported, stopSpeaking, watchVoices } from '../lib/speech'
import { Icon } from './Icon'

interface Props {
  subscribeGestures: (fn: GestureListener) => () => void
  status: GestureStatus
}

interface Spoken {
  label: string
  phrase: string
}

const UI_INTERVAL_MS = 100 // l'écran se met à jour 10 fois par seconde, pas à chaque image
const BARS = 4

const percent = (p: number) => `${Math.round(p * 100)} %`

export function GesturePanel({ subscribeGestures, status }: Props) {
  const [view, setView] = useState<StableGesture | null>(null)
  const [spoken, setSpoken] = useState<Spoken | null>(null)
  const [voiceOn, setVoiceOn] = useState(true)
  const [frenchVoice, setFrenchVoice] = useState<boolean | null>(null) // null : liste pas encore chargée
  const voiceRef = useRef(voiceOn)

  useEffect(() => {
    voiceRef.current = voiceOn
    if (!voiceOn) stopSpeaking()
  }, [voiceOn])

  useEffect(() => watchVoices((voices) => setFrenchVoice(voices.length === 0 ? null : pickVoice(voices) !== null)), [])

  useEffect(() => {
    const stabilize = createStabilizer()
    let lastUi = 0
    const unsubscribe = subscribeGestures((frame) => {
      const state = stabilize(frame.scores)
      if (state.confirmed) {
        const info = gestureInfo(state.confirmed)
        if (info.phrase) {
          setSpoken({ label: info.label, phrase: info.phrase })
          if (voiceRef.current) speak(info.phrase)
        }
      }
      const now = performance.now()
      if (state.confirmed || now - lastUi >= UI_INTERVAL_MS) {
        lastUi = now
        setView(state)
      }
    })
    return () => {
      unsubscribe()
      stopSpeaking()
    }
  }, [subscribeGestures])

  const top = view?.top ?? null
  const hasHand = top !== null
  const ranked = view
    ? Object.entries(view.probs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, BARS)
    : []

  return (
    <div className="panel">
      <p className="lead">
        Démonstration avec le reconnaisseur de gestes de Google, déjà entraîné. Il connaît 7 gestes de la main.{' '}
        <strong>Ce ne sont pas des signes d'une langue des signes.</strong>
      </p>

      {status === 'loading' && <p className="muted">Chargement du modèle de gestes…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          Le modèle de gestes n'a pas pu se charger. Vérifiez la connexion, puis changez d'onglet et revenez.
        </p>
      )}

      <section className="gesture-now" aria-live="polite" aria-label="Geste reconnu">
        {hasHand && top !== 'None' ? (
          <>
            <p className="gesture-name">
              {gestureInfo(top).label} <span className="gesture-score">{percent(view?.topScore ?? 0)}</span>
            </p>
            {gestureInfo(top).phrase && <p className="gesture-phrase">« {gestureInfo(top).phrase} »</p>}
          </>
        ) : (
          <p className="empty">
            {hasHand ? 'Aucun geste reconnu.' : 'Faites un geste devant la caméra : pouce en haut, main ouverte, victoire…'}
          </p>
        )}
      </section>

      {ranked.length > 0 && (
        <ul className="bars" aria-label="Probabilité de chaque geste">
          {ranked.map(([name, p]) => (
            <li key={name}>
              <span className="bar-label">{gestureInfo(name).label}</span>
              <span className="bar-track" aria-hidden>
                <span className="bar-fill" style={{ width: `${Math.round(p * 100)}%` }} />
              </span>
              <span className="bar-value">{percent(p)}</span>
            </li>
          ))}
        </ul>
      )}

      {!speechSupported() && (
        <p className="note">
          <Icon name="alert" size={16} /> La synthèse vocale n'est pas disponible dans ce navigateur.
        </p>
      )}
      {speechSupported() && frenchVoice === false && (
        <p className="note">
          <Icon name="alert" size={16} /> Aucune voix française sur cet appareil : la phrase sera lue avec la voix par défaut,
          peut-être avec un accent étranger. Installez une voix française dans les réglages du système.
        </p>
      )}

      <div className="actions-bar">
        <div className="actions">
          <button
            className={`btn ${voiceOn ? 'btn-primary' : 'btn-quiet'}`}
            aria-pressed={voiceOn}
            onClick={() => setVoiceOn(!voiceOn)}
          >
            Voix : {voiceOn ? 'activée' : 'coupée'}
          </button>
          <button
            className="btn btn-quiet"
            disabled={!spoken || !speechSupported()}
            onClick={() => spoken && speak(spoken.phrase)}
            title={spoken ? `Réécouter : ${spoken.phrase}` : 'Aucune phrase à réécouter'}
          >
            Réécouter
          </button>
        </div>
      </div>
    </div>
  )
}
