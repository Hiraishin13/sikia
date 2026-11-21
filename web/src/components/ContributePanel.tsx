import { useEffect, useRef, useState } from 'react'
import type { FrameListener } from '../hooks/useCapture'
import { normalizeFrame, type KeypointFrame } from '../lib/landmarks'
import { downloadRecording, finalizeRecording, statsOf, type Recording } from '../lib/recording'
import { Icon } from './Icon'

interface Props {
  subscribe: (fn: FrameListener) => () => void
  recordings: Recording[]
  onRecorded: (r: Recording) => void
}

const SIGNER_KEY = 'sikia.signer'

/** Le pseudo est mémorisé sur l'appareil seulement ; le stockage peut être bloqué (navigation privée). */
function readSigner(): string {
  try {
    return localStorage.getItem(SIGNER_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveSigner(value: string) {
  try {
    localStorage.setItem(SIGNER_KEY, value)
  } catch {
    /* sans importance */
  }
}

const GOOD_TRACKING = 0.7 // part d'images avec les deux mains, en dessous : refaire l'essai

export function ContributePanel({ subscribe, recordings, onRecorded }: Props) {
  const [label, setLabel] = useState('')
  const [signer, setSigner] = useState(readSigner)
  const [recording, setRecording] = useState(false)
  const [elapsedS, setElapsedS] = useState(0)
  const framesRef = useRef<KeypointFrame[]>([])

  useEffect(() => {
    if (!recording) return
    const startedAt = performance.now()
    const frames: KeypointFrame[] = []
    framesRef.current = frames
    const unsubscribe = subscribe((raw, now) => {
      frames.push(normalizeFrame(raw, now - startedAt))
      if (frames.length % 5 === 0) setElapsedS((now - startedAt) / 1000)
    })
    return unsubscribe
  }, [recording, subscribe])

  const stop = () => {
    setRecording(false)
    const frames = framesRef.current
    if (frames.length === 0) return
    onRecorded(
      finalizeRecording({
        id: Date.now().toString(36),
        label: label.trim(),
        signer: signer.trim(),
        createdAt: new Date().toISOString(),
        frames,
      }),
    )
  }

  const canRecord = label.trim().length > 0

  return (
    <div className="panel">
      <p className="lead">
        Enregistrez un signe pour enrichir le vocabulaire. Les fichiers restent sur votre appareil tant
        que vous ne les exportez pas.
      </p>

      <label className="field">
        <span>Votre pseudo</span>
        <input
          value={signer}
          placeholder="Pas votre nom : un pseudo suffit"
          disabled={recording}
          onChange={(e) => {
            setSigner(e.target.value)
            saveSigner(e.target.value)
          }}
        />
        <small className="hintline">Il regroupe vos enregistrements, pour évaluer le modèle sur des personnes qu'il n'a jamais vues.</small>
      </label>

      <label className="field">
        <span>Quel signe allez-vous faire ?</span>
        <input
          value={label}
          placeholder="Par exemple : BONJOUR"
          disabled={recording}
          autoCapitalize="characters"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      {recordings.length > 0 && (
        <section className="recordings" aria-label="Enregistrements">
          <h2>Enregistrements</h2>
          <ul>
            {recordings.map((r) => {
              const s = statsOf(r)
              const good = s.bothHands >= GOOD_TRACKING
              return (
                <li key={r.id}>
                  <div>
                    <strong>{r.label}</strong>
                    <span className="meta">{s.durationS.toFixed(1)} s</span>
                    <span className={`quality ${good ? 'quality-ok' : 'quality-low'}`}>
                      <Icon name={good ? 'check' : 'alert'} size={16} />
                      {good
                        ? 'Mains bien suivies'
                        : `Mains suivies sur ${Math.round(s.bothHands * 100)} % : refaites l'essai`}
                    </span>
                  </div>
                  <button className="btn btn-quiet" onClick={() => downloadRecording(r)}>
                    <Icon name="download" /> Exporter
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="actions-bar">
        {!recording && !canRecord && <p className="hintline">Indiquez d'abord le nom du signe.</p>}
        <button
          className={`btn ${recording ? 'btn-stop' : 'btn-primary'}`}
          disabled={!recording && !canRecord}
          onClick={
            recording
              ? stop
              : () => {
                  setElapsedS(0)
                  setRecording(true)
                }
          }
        >
          {recording ? `Arrêter · ${elapsedS.toFixed(1)} s` : 'Enregistrer le signe'}
        </button>
      </div>
    </div>
  )
}
