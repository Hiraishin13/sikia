import { useEffect, useState } from 'react'
import type { FrameListener } from '../hooks/useCapture'
import { normalizeFrame } from '../lib/landmarks'
import { StreamClient, type ConnectionState, type Gloss, type Sentence } from '../lib/stream'
import { CorrectionForm } from './CorrectionForm'
import { glossText } from '../lib/gloss'
import { Icon } from './Icon'

export type { Sentence }

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
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [correctedIds, setCorrectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!active) return
    const startedAt = performance.now()
    const client = new StreamClient({
      onState: setConn,
      onMessage: (msg) => {
        if (msg.type === 'ready') setSessionId(msg.session_id)
        else if (msg.type === 'partial') setPartial(msg.glosses)
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
  const [copied, setCopied] = useState(false)

  const copyLatest = () => {
    if (!latest) return
    const text = latest.text ?? latest.glosses.map((g) => glossText(g.gloss)).join(' ')
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }

  const lineProps = (s: Sentence) => ({
    sentence: s,
    editing: editingId === s.sentence_id,
    corrected: correctedIds.has(s.sentence_id),
    onEdit: () => setEditingId(s.sentence_id),
    sessionId,
    shared: sharedIds.has(s.sentence_id),
    onDone: (sent: boolean, shared?: boolean) => {
      setEditingId(null)
      if (sent) setCorrectedIds((ids) => new Set(ids).add(s.sentence_id))
      if (shared) setSharedIds((ids) => new Set(ids).add(s.sentence_id))
    },
  })

  return (
    <div className="panel">
      {conn && (
        <p className={`conn conn-${conn}`} role="status">
          {CONNECTION_TEXT[conn]}
        </p>
      )}

      {/* Annonce la dernière phrase aux lecteurs d'écran sans lire les formulaires de correction. */}
      <p className="sr-only" aria-live="polite">
        {latest ? (latest.text ?? latest.glosses.map((g) => glossText(g.gloss)).join(' ')) : ''}
      </p>

      <section className="card translation" aria-labelledby="translation-title">
      <header className="card-head">
        <h2 id="translation-title">
          <span className={`live-dot${active ? ' is-on' : ''}`} aria-hidden />
          {active ? 'Traduction active (LSF vers français écrit)' : 'Traduction en attente'}
        </h2>
        <button className="btn btn-tool" disabled={!latest} onClick={copyLatest} title="Copier la dernière phrase">
          <Icon name="copy" size={18} /> {copied ? 'Copié' : 'Copier'}
        </button>
      </header>

      <div className={`output${flipped ? ' is-flipped' : ''}`}>
        {partial.length > 0 && (
          <p className="partial">
            <span className="label label-live">En cours</span> {partial.map((g) => glossText(g.gloss)).join(' · ')}
          </p>
        )}

        {latest ? (
          <>
            <SentenceLine {...lineProps(latest)} large />
            {earlier.length > 0 && (
              <ul className="earlier">
                {earlier.map((s) => (
                  <li key={s.sentence_id}>
                    <SentenceLine {...lineProps(s)} />
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
      </section>

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

interface LineProps {
  sentence: Sentence
  editing: boolean
  corrected: boolean
  shared: boolean
  sessionId?: string
  onEdit: () => void
  onDone: (sent: boolean, shared?: boolean) => void
  large?: boolean
}

function SentenceLine({ sentence, editing, corrected, shared, sessionId, onEdit, onDone, large = false }: LineProps) {
  const raw = sentence.glosses.map((g) => glossText(g.gloss)).join(' ')
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

      {editing ? (
        <CorrectionForm sentence={sentence} sessionId={sessionId} onDone={onDone} />
      ) : corrected ? (
        <p className="note note-ok">
          <Icon name="check" size={16} /> {shared ? 'Merci, correction et geste envoyés.' : 'Merci, correction envoyée.'}
        </p>
      ) : (
        <button className="btn btn-link" onClick={onEdit}>
          Corriger
        </button>
      )}
    </div>
  )
}
