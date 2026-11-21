import { useEffect, useState } from 'react'
import type { FrameListener } from '../hooks/useCapture'
import { normalizeFrame } from '../lib/landmarks'
import { StreamClient, type ConnectionState, type Gloss, type ServerMessage } from '../lib/stream'
import { Icon } from './Icon'

export type Sentence = Extract<ServerMessage, { type: 'final' }>

interface Props {
  subscribe: (fn: FrameListener) => () => void
  sentences: Sentence[]
  onSentence: (s: Sentence) => void
}

const CONNECTION_TEXT: Record<ConnectionState, string> = {
  connecting: 'Connexion au serveur…',
  open: 'Connecté',
  closed: 'Serveur injoignable',
}

export function TranslatePanel({ subscribe, sentences, onSentence }: Props) {
  const [active, setActive] = useState(false)
  const [conn, setConn] = useState<ConnectionState | null>(null)
  const [partial, setPartial] = useState<Gloss[]>([])
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!active) return
    const startedAt = performance.now()
    const client = new StreamClient({
      onState: setConn,
      onMessage: (msg) => {
        if (msg.type === 'partial') setPartial(msg.glosses)
        else if (msg.type === 'final') {
          setPartial([])
          onSentence(msg)
        }
      },
    })
    const unsubscribe = subscribe((raw, now) => client.push(normalizeFrame(raw, now - startedAt)))
    return () => {
      unsubscribe()
      client.close()
      setConn(null)
      setPartial([])
    }
  }, [active, subscribe, onSentence])

  const [latest, ...earlier] = sentences

  return (
    <div className="panel">
      {conn && (
        <p className={`conn conn-${conn}`} role="status">
          {CONNECTION_TEXT[conn]}
        </p>
      )}

      <div className={`output${flipped ? ' is-flipped' : ''}`} aria-live="polite">
        {partial.length > 0 && (
          <p className="partial">
            <span className="label">En cours</span> {partial.map((g) => g.gloss).join(' · ')}
          </p>
        )}

        {latest ? (
          <>
            <SentenceLine sentence={latest} large />
            {earlier.length > 0 && (
              <ul className="earlier">
                {earlier.map((s) => (
                  <li key={s.sentence_id}>
                    <SentenceLine sentence={s} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="empty">
            {active
              ? 'Signez face à la caméra. Baissez les mains un instant à la fin de la phrase.'
              : 'La traduction apparaîtra ici, en grands caractères, pour la personne en face de vous.'}
          </p>
        )}
      </div>

      {/* Dernier dans la page : sur mobile la barre reste collée en bas, à portée du pouce. */}
      <div className="actions-bar">
        <div className="actions">
          <button className={`btn ${active ? 'btn-stop' : 'btn-primary'}`} onClick={() => setActive(!active)}>
            {active ? 'Arrêter' : 'Commencer la traduction'}
          </button>
          <button
            className="btn btn-quiet"
            aria-pressed={flipped}
            onClick={() => setFlipped(!flipped)}
            title="Retourner le texte pour la personne en face"
          >
            <Icon name="flip" /> Retourner
          </button>
        </div>
      </div>
    </div>
  )
}

function SentenceLine({ sentence, large = false }: { sentence: Sentence; large?: boolean }) {
  const raw = sentence.glosses.map((g) => g.gloss).join(' ')
  return (
    <div className={large ? 'sentence sentence-large' : 'sentence'}>
      <p className="sentence-text">{sentence.text ?? raw}</p>
      {sentence.degraded && (
        <p className="note">
          <Icon name="alert" size={16} /> Traduction indisponible : signes reconnus affichés tels quels.
        </p>
      )}
      {!sentence.degraded && sentence.uncertain && (
        <p className="note">
          <Icon name="alert" size={16} /> Traduction incertaine. Signes reconnus : {raw}.
        </p>
      )}
    </div>
  )
}
