import { useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { lab, pct, type ActiveItem, type Sample } from '../../lib/lab'
import { KeypointPlayer } from './KeypointPlayer'
import { Empty, ErrorNote, Section } from './ui'

export function ReviewSection() {
  const review = useAsync(() => lab.review())
  const [error, setError] = useState('')

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      review.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Section title="Corrections à valider">
        <p className="lead">
          Quand quelqu'un corrige une réponse et accepte de partager son geste, l'exemple arrive ici. Il ne sert à
          l'entraînement qu'après votre validation : regardez le geste, puis confirmez ou corrigez le signe.
        </p>
        <ErrorNote message={error || review.error} />
        {review.data && review.data.pending.length === 0 && <Empty>Aucune correction en attente.</Empty>}
        <ul className="review-list">
          {review.data?.pending.map((s) => <PendingItem key={s.id} s={s} act={act} />)}
        </ul>
      </Section>

      <Section title="Exemples sans label">
        {review.data && review.data.unlabeled.length === 0 && <Empty>Aucun exemple à annoter.</Empty>}
        <ul className="review-list">
          {review.data?.unlabeled.map((s) => <PendingItem key={s.id} s={s} act={act} />)}
        </ul>
      </Section>

      <ActiveLearning onLabeled={review.reload} />
    </>
  )
}

function PendingItem({ s, act }: { s: Sample; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [label, setLabel] = useState(s.label)
  const [show, setShow] = useState(false)
  const changed = label.trim().toUpperCase() !== s.label
  return (
    <li className="review-item">
      <div>
        {s.predicted_label ? (
          <p>
            Le modèle a dit <strong>{s.predicted_label}</strong> ({pct(s.predicted_conf, 0)}). La personne indique{' '}
            <strong>{s.label || '—'}</strong>.
          </p>
        ) : (
          <p>Exemple sans signe indiqué.</p>
        )}
        <p className="hintline">
          {s.signer || 'personne inconnue'} · {s.duration_s.toFixed(1)} s · qualité {pct(s.quality, 0)}
          {s.issues.length ? ` · ${s.issues.join(', ')}` : ''}
        </p>
        {show && <KeypointPlayer sampleId={s.id} />}
        <label className="field">
          <span>Signe (corrigez si besoin)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <div className="row-actions">
        <button className="btn btn-quiet" onClick={() => setShow(!show)}>{show ? 'Masquer le geste' : 'Voir le geste'}</button>
        <button className="btn btn-primary" disabled={!label.trim()} onClick={() => void act(() => lab.validate(s.id, { label }))}>
          {changed ? 'Corriger et valider' : 'Valider'}
        </button>
        <button className="btn btn-quiet" onClick={() => void act(() => lab.rejectSample(s.id))}>Rejeter</button>
      </div>
    </li>
  )
}

function ActiveLearning({ onLabeled }: { onLabeled: () => void }) {
  const [strategy, setStrategy] = useState('margin')
  const [n, setN] = useState(20)
  const [items, setItems] = useState<ActiveItem[] | null>(null)
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await lab.activeLearning(n, strategy)
      setItems(r.items)
      setModel(r.model)
    } catch (e) {
      setItems(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Apprentissage actif">
      <p className="lead">
        Le modèle repère les exemples sans label sur lesquels il hésite le plus. Les annoter en priorité est ce qui le fait
        progresser le plus vite.
      </p>
      <div className="inline-form">
        <label className="field"><span>Nombre d'exemples</span><input type="number" min={1} max={200} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
        <label className="field"><span>Mesure d'incertitude</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="margin">Hésitation entre deux signes</option>
            <option value="entropy">Dispersion sur tous les signes</option>
            <option value="confidence">Faible confiance</option>
          </select></label>
        <button className="btn btn-quiet" disabled={busy} onClick={load}>Chercher</button>
      </div>
      <ErrorNote message={error} />
      {items && items.length === 0 && <Empty>Aucun exemple non annoté à proposer.</Empty>}
      {items && items.length > 0 && (
        <>
          <p><strong>Ces {items.length} exemples sont ceux sur lesquels la version {model} est la moins sûre.</strong> Voulez-vous les annoter ?</p>
          <ul className="review-list">
            {items.map((it) => <ActiveRow key={it.sample.id} it={it} done={() => { setItems((cur) => cur?.filter((x) => x.sample.id !== it.sample.id) ?? null); onLabeled() }} />)}
          </ul>
        </>
      )}
    </Section>
  )
}

function ActiveRow({ it, done }: { it: ActiveItem; done: () => void }) {
  const [label, setLabel] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const validate = async (value: string) => {
    setError('')
    try {
      await lab.validate(it.sample.id, { label: value })
      done()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <li className="review-item">
      <div>
        <p className="hintline">Écart entre les deux meilleures hypothèses : {pct(it.margin, 0)} · {it.sample.duration_s.toFixed(1)} s · {it.sample.signer || 'personne inconnue'}</p>
        {show && <KeypointPlayer sampleId={it.sample.id} />}
        <div className="chips">
          {it.hypotheses.map((h) => (
            <button key={h.label} className="btn btn-quiet chip" onClick={() => void validate(h.label)} title="Confirmer cette hypothèse du modèle">
              {h.label} · {pct(h.confidence, 0)}
            </button>
          ))}
        </div>
        <label className="field"><span>Ou un autre signe</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <ErrorNote message={error} />
      </div>
      <div className="row-actions">
        <button className="btn btn-quiet" onClick={() => setShow(!show)}>{show ? 'Masquer le geste' : 'Voir le geste'}</button>
        <button className="btn btn-primary" disabled={!label.trim()} onClick={() => void validate(label)}>Valider</button>
      </div>
    </li>
  )
}
