import { useEffect, useRef, useState } from 'react'
import { sendFeedback, sentenceCorrection, signCorrection } from '../lib/feedback'
import type { Sentence } from '../lib/stream'
import { glossText } from '../lib/gloss'
import { Icon } from './Icon'

type Step = 'choose' | 'sentence' | 'pick-sign' | 'new-sign'
type Status = 'idle' | 'sending' | 'error'

interface Props {
  sentence: Sentence
  /** Session du flux : permet de retrouver le geste concerné si la personne accepte de le partager. */
  sessionId?: string
  onDone: (sent: boolean, shared?: boolean) => void
}

/**
 * Correction d'une traduction en deux gestes : « la phrase » ou « un signe », puis la bonne réponse.
 * Chaque correction nourrit l'amélioration du modèle ; seul du texte est envoyé.
 */
export function CorrectionForm({ sentence, sessionId, onDone }: Props) {
  const raw = sentence.glosses.map((g) => g.gloss).join(' ')
  const [step, setStep] = useState<Step>('choose')
  const [text, setText] = useState(sentence.text ?? raw)
  const [signIdx, setSignIdx] = useState(0)
  const [other, setOther] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [share, setShare] = useState(false) // jamais coché par défaut : le consentement doit être un geste volontaire
  const ref = useRef<HTMLDivElement>(null)

  // À chaque étape, le formulaire reste visible (sinon il passe sous la barre d'actions collée en bas).
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [step])

  const submit = async (payload: Parameters<typeof sendFeedback>[0]) => {
    setStatus('sending')
    const res = await sendFeedback(payload)
    if (res.ok) onDone(true, res.shared)
    else setStatus('error')
  }

  const wrongSign = sentence.glosses[signIdx]
  const sharing = share && sessionId ? { sessionId } : undefined

  return (
    <div ref={ref} className="correction" role="group" aria-label="Corriger la traduction">
      {step === 'choose' && (
        <>
          <p className="correction-title">Qu'est-ce qui est faux ?</p>
          <div className="correction-actions">
            <button className="btn btn-quiet" onClick={() => setStep('sentence')}>
              La phrase
            </button>
            <button className="btn btn-quiet" onClick={() => setStep('pick-sign')}>
              Un signe
            </button>
            <button className="btn btn-link" onClick={() => onDone(false)}>
              Annuler
            </button>
          </div>
        </>
      )}

      {step === 'sentence' && (
        <>
          <label className="field">
            <span>Quelle phrase vouliez-vous dire ?</span>
            <input value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
          <div className="correction-actions">
            <button
              className="btn btn-primary"
              disabled={status === 'sending' || text.trim().length === 0}
              onClick={() => submit(sentenceCorrection(sentence, text))}
            >
              Envoyer la correction
            </button>
            <button className="btn btn-link" onClick={() => setStep('choose')}>
              Retour
            </button>
          </div>
        </>
      )}

      {step === 'pick-sign' && (
        <>
          <p className="correction-title">Quel signe est faux ?</p>
          <div className="chips">
            {sentence.glosses.map((g, i) => (
              <button
                key={`${g.gloss}-${i}`}
                className="btn btn-quiet chip"
                onClick={() => {
                  setSignIdx(i)
                  setOther('')
                  setStep('new-sign')
                }}
              >
                {glossText(g.gloss)}
              </button>
            ))}
          </div>
          <button className="btn btn-link" onClick={() => setStep('choose')}>
            Retour
          </button>
        </>
      )}

      {step === 'new-sign' && wrongSign && (
        <>
          <p className="correction-title">
            Vous avez signé quoi, à la place de <strong>{glossText(wrongSign.gloss)}</strong> ?
          </p>
          {wrongSign.alternatives.length > 0 && (
            <div className="chips">
              {wrongSign.alternatives.map((a) => (
                <button
                  key={a.gloss}
                  className="btn btn-quiet chip"
                  disabled={status === 'sending'}
                  onClick={() => submit(signCorrection(sentence, signIdx, a.gloss, sharing))}
                >
                  {a.gloss}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span>{wrongSign.alternatives.length > 0 ? 'Ou un autre signe' : 'Nom du signe'}</span>
            <input
              value={other}
              placeholder="Par exemple : MERCI"
              autoCapitalize="characters"
              onChange={(e) => setOther(e.target.value)}
            />
          </label>
          {sessionId && (
            <label className="consent">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>
                <strong>Partager ce geste pour améliorer l'application</strong>
                <small>
                  Seuls les points de vos mains, de votre corps et de votre visage sont conservés, jamais la vidéo.
                  Une personne vérifie chaque exemple avant qu'il serve à entraîner le modèle.
                </small>
              </span>
            </label>
          )}
          <div className="correction-actions">
            <button
              className="btn btn-primary"
              disabled={status === 'sending' || other.trim().length === 0}
              onClick={() => submit(signCorrection(sentence, signIdx, other, sharing))}
            >
              Envoyer la correction
            </button>
            <button className="btn btn-link" onClick={() => setStep('pick-sign')}>
              Retour
            </button>
          </div>
        </>
      )}

      {status === 'error' && (
        <p className="correction-error" role="alert">
          <Icon name="alert" size={16} /> Envoi impossible. Vérifiez la connexion et réessayez.
        </p>
      )}
      <p className="correction-note">
        <Icon name="lock" size={16} /> Seul du texte est envoyé, jamais la vidéo.
      </p>
    </div>
  )
}
