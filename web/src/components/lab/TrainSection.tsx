import { useEffect, useMemo, useRef, useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { MODE_LABEL, dateFr, duration, lab, pct, type Run, type RunEvent } from '../../lib/lab'
import { LineChart, Meter } from './charts'
import type { Part } from './LabApp'
import { Badge, Empty, ErrorNote, Section, Stat } from './ui'

const MODES: { id: string; title: string; help: string }[] = [
  { id: 'initial', title: 'Entraînement initial', help: 'Crée un modèle à partir de zéro sur les jeux choisis.' },
  { id: 'finetune', title: 'Fine-tuning', help: 'Améliore un modèle existant avec de nouvelles données, sans repartir de zéro. Les nouveaux signes sont ajoutés.' },
  { id: 'incremental', title: 'Incrémental', help: "Comme le fine-tuning, en rejouant une partie des anciens exemples pour que le modèle n'oublie pas ce qu'il savait." },
  { id: 'transfer', title: 'Transfert', help: "Part d'un modèle déjà entraîné et n'apprend d'abord que la dernière couche, puis ajuste le reste. Le plus sûr quand les données sont peu nombreuses." },
]

const DEFAULTS = {
  epochs: 40, batch_size: 32, lr: 0.0005, val_frac: 0.15, test_frac: 0.15, min_examples_per_class: 2,
  balance: 'class', replay_fraction: 0.3, freeze_epochs: 5, target_precision: 0.9, size: 'standard', name: '', languages: '',
}
const SIZES: Record<string, { label: string; model: Record<string, number> }> = {
  small: { label: 'Petit (rapide, peu de données)', model: { d_model: 128, heads: 4, layers: 2, ff: 256 } },
  standard: { label: 'Standard', model: { d_model: 256, heads: 4, layers: 4, ff: 512 } },
}

export function TrainSection({ go }: { go: (p: Part) => void }) {
  const datasets = useAsync(() => lab.datasets())
  const models = useAsync(() => lab.models())
  const runs = useAsync(() => lab.runs())
  const [mode, setMode] = useState('initial')
  const [selected, setSelected] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [p, setP] = useState(DEFAULTS)
  const [error, setError] = useState('')
  const [watching, setWatching] = useState<string | null>(null)

  // Suit l'entraînement choisi ; à défaut celui qui est en cours, sinon le plus récent.
  const liveId = runs.data?.find((r) => r.status === 'running' || r.status === 'queued')?.id
  const current = watching ?? liveId ?? runs.data?.[0]?.id ?? null

  const usable = useMemo(() => (models.data ?? []).filter((m) => m.status !== 'rejected'), [models.data])
  const needsBase = mode !== 'initial'
  const canStart = selected.length > 0 && (!needsBase || base)

  const start = async () => {
    setError('')
    try {
      const run = await lab.startTraining({
        mode,
        dataset_ids: selected,
        base_model_id: needsBase ? base : null,
        epochs: Number(p.epochs),
        batch_size: Number(p.batch_size),
        lr: Number(p.lr),
        val_frac: Number(p.val_frac),
        test_frac: Number(p.test_frac),
        min_examples_per_class: Number(p.min_examples_per_class),
        balance: p.balance,
        replay_fraction: Number(p.replay_fraction),
        freeze_epochs: Number(p.freeze_epochs),
        target_precision: Number(p.target_precision),
        languages: p.languages.trim() ? p.languages.split(',').map((s) => s.trim()).filter(Boolean) : null,
        model: SIZES[p.size].model,
        name: p.name.trim(),
      })
      setWatching(run.id)
      runs.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Section title="Lancer un entraînement">
        <fieldset className="mode-list">
          <legend className="sr-only">Type d'entraînement</legend>
          {MODES.map((m) => (
            <label key={m.id} className={mode === m.id ? 'mode is-on' : 'mode'}>
              <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <span>
                <strong>{m.title}</strong>
                <small>{m.help}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <h3>Jeux de données</h3>
        {datasets.data?.length === 0 && <Empty>Créez et remplissez d'abord un jeu de données.</Empty>}
        <ul className="dataset-list">
          {datasets.data?.map((d) => (
            <li key={d.id}>
              <label>
                <input type="checkbox" checked={selected.includes(d.id)}
                  onChange={() => setSelected((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))} />
                <span>
                  <strong>{d.name}</strong>
                  {d.synthetic && <span className="badge badge-synthetic">synthétique</span>}
                  <small>{d.n_validated ?? 0} exemples validés · {d.sign_language || 'langue non précisée'}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {needsBase && (
          <label className="field">
            <span>Version de départ</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              <option value="">Choisir…</option>
              {usable.map((m) => (
                <option key={m.id} value={m.id}>{m.version} — {pct(m.accuracy)} ({MODE_LABEL[m.mode] ?? m.mode})</option>
              ))}
            </select>
            {usable.length === 0 && <small className="hintline">Aucune version existante : commencez par un entraînement initial.</small>}
          </label>
        )}

        <details className="advanced">
          <summary>Réglages (les valeurs par défaut conviennent pour commencer)</summary>
          <div className="params">
            <Num label="Époques" help="Nombre de passes sur les données. L'arrêt est automatique si le modèle ne progresse plus." value={p.epochs} onChange={(v) => setP({ ...p, epochs: v })} />
            <Num label="Taille de lot" value={p.batch_size} onChange={(v) => setP({ ...p, batch_size: v })} />
            <Num label="Vitesse d'apprentissage" step="0.0001" value={p.lr} onChange={(v) => setP({ ...p, lr: v })} help="Réduite automatiquement (×0,2) pour les modes qui partent d'un modèle existant." />
            <Num label="Part validation" step="0.05" value={p.val_frac} onChange={(v) => setP({ ...p, val_frac: v })} help="Personnes réservées pour choisir le meilleur moment d'arrêt." />
            <Num label="Part test" step="0.05" value={p.test_frac} onChange={(v) => setP({ ...p, test_frac: v })} help="Personnes jamais vues, réservées à la note finale. Figées une fois attribuées." />
            <Num label="Exemples minimum par signe" value={p.min_examples_per_class} onChange={(v) => setP({ ...p, min_examples_per_class: v })} />
            <Num label="Précision visée pour « non reconnu »" step="0.05" value={p.target_precision} onChange={(v) => setP({ ...p, target_precision: v })} help="Sous le seuil de confiance calibré, l'application répond « signe non reconnu »." />
            {mode === 'incremental' && <Num label="Part rejouée de l'ancien jeu" step="0.1" value={p.replay_fraction} onChange={(v) => setP({ ...p, replay_fraction: v })} />}
            {mode === 'transfer' && <Num label="Époques « dernière couche seule »" value={p.freeze_epochs} onChange={(v) => setP({ ...p, freeze_epochs: v })} />}
            <label className="field"><span>Équilibrage des signes</span>
              <select value={p.balance} onChange={(e) => setP({ ...p, balance: e.target.value })}>
                <option value="class">Équilibrer les signes rares</option>
                <option value="none">Aucun</option>
              </select></label>
            <label className="field"><span>Taille du modèle</span>
              <select value={p.size} onChange={(e) => setP({ ...p, size: e.target.value })}>
                {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              {needsBase && <small className="hintline">Ignorée : la taille du modèle de départ est conservée.</small>}</label>
            <label className="field"><span>Langues à inclure</span>
              <input value={p.languages} placeholder="toutes (ex. LSF, ASL)" onChange={(e) => setP({ ...p, languages: e.target.value })} /></label>
            <label className="field"><span>Nom (facultatif)</span>
              <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
          </div>
        </details>

        <ErrorNote message={error} />
        <div className="actions">
          <button className="btn btn-primary" disabled={!canStart} onClick={start}>Lancer l'entraînement</button>
        </div>
        <p className="hintline">Le modèle obtenu est un <strong>candidat</strong> : il ne sera jamais mis en service sans votre décision.</p>
      </Section>

      {current && <Dashboard runId={current} onFinished={() => { runs.reload(); models.reload() }} go={go} />}

      <Section title="Historique des entraînements">
        {runs.data?.length === 0 && <Empty>Aucun entraînement.</Empty>}
        {runs.data && runs.data.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Statut</th><th>Durée</th><th /></tr></thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className={r.id === current ? 'row-on' : undefined}>
                    <td>{dateFr(r.created_at)}</td>
                    <td>{MODE_LABEL[String(r.params.mode)] ?? '—'}</td>
                    <td><Badge status={r.status} /></td>
                    <td>{r.started_at && r.finished_at ? duration(r.finished_at - r.started_at) : r.started_at ? 'en cours' : '—'}</td>
                    <td><button className="btn btn-link" onClick={() => setWatching(r.id)}>Suivre</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}

function Num({ label, value, onChange, step, help }: { label: string; value: number; onChange: (v: number) => void; step?: string; help?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step ?? '1'} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <small className="hintline">{help}</small>}
    </label>
  )
}

/** Suivi en direct : on interroge le journal de l'entraînement tant qu'il tourne. */
function Dashboard({ runId, onFinished, go }: { runId: string; onFinished: () => void; go: (p: Part) => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const [error, setError] = useState('')
  const next = useRef(0)
  const finished = useRef(false)

  useEffect(() => {
    let alive = true
    next.current = 0
    finished.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents([])
    setRun(null)
    const tick = async () => {
      try {
        const r = await lab.run(runId, next.current)
        if (!alive) return
        next.current = r.next ?? next.current
        if (r.events?.length) setEvents((e) => [...e, ...r.events!])
        setRun(r)
        setError('')
        if (r.status !== 'running' && r.status !== 'queued' && !finished.current) {
          finished.current = true
          onFinished()
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void tick()
    const id = setInterval(() => !finished.current && void tick(), 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const epochs = events.filter((e) => e.type === 'epoch')
  const data = events.find((e) => e.type === 'data')
  const done = events.find((e) => e.type === 'done')
  const classes = events.find((e) => e.type === 'classes')
  const replay = events.find((e) => e.type === 'replay')
  const stop = events.find((e) => e.type === 'early_stop')
  const last = epochs.at(-1)
  const best = epochs.reduce<RunEvent | null>((b, e) => ((e.val_macro_f1 ?? 0) > (b?.val_macro_f1 ?? -1) ? e : b), null)
  const live = run?.status === 'running' || run?.status === 'queued'
  const xs = epochs.map((e) => e.epoch ?? 0)

  if (!run) return <Section title="Suivi de l'entraînement">{error ? <ErrorNote message={error} /> : <p className="muted">Chargement…</p>}</Section>

  return (
    <Section
      title="Suivi de l'entraînement"
      aside={live ? <button className="btn btn-quiet" onClick={() => void lab.cancelRun(runId).then(() => setRun({ ...run, status: 'cancelled' }))}>Annuler</button> : undefined}
    >
      <ErrorNote message={error} />
      <div className="stats">
        <Stat label="État" value={<Badge status={run.status} />} note={MODE_LABEL[String(run.params.mode)]} />
        <Stat label="Époque" value={last ? `${last.epoch} / ${last.epochs}` : '—'} />
        <Stat label="Meilleure validation (F1)" value={pct(best?.val_macro_f1)} note={best ? `à l'époque ${best.epoch}` : undefined} />
        <Stat label="Précision de validation" value={pct(last?.val_accuracy)} />
      </div>
      {live && <Meter value={last ? (last.epoch ?? 0) / (last.epochs ?? 1) : 0} label="Progression de l'entraînement" />}

      {data && (
        <p className="hintline">
          Données utilisées : {data.train} pour apprendre, {data.val} pour choisir, {data.test} pour la note finale
          {classes ? ` · ${classes.n} signes` : ''}{classes?.new?.length ? ` dont nouveaux : ${classes.new.join(', ')}` : ''}
          {replay ? ` · ${replay.replayed} anciens exemples rejoués` : ''}.
        </p>
      )}
      {stop && <p className="note">Arrêt anticipé à l'époque {stop.epoch} : le modèle ne progressait plus.</p>}

      <div className="grid-2">
        <LineChart title="Perte" xs={xs} yMin={0} series={[
          { name: 'Apprentissage', values: epochs.map((e) => e.loss ?? null), dashed: true },
          { name: 'Validation', values: epochs.map((e) => e.val_loss ?? null) },
        ]} />
        <LineChart title="Qualité sur la validation" xs={xs} yMin={0} yMax={1} format={(v) => pct(v, 0)} series={[
          { name: 'Précision', values: epochs.map((e) => e.val_accuracy ?? null), dashed: true },
          { name: 'F1 moyen', values: epochs.map((e) => e.val_macro_f1 ?? null) },
        ]} />
      </div>
      {epochs.some((e) => e.frozen) && <p className="hintline">Les {epochs.filter((e) => e.frozen).length} premières époques n'entraînent que la dernière couche (transfert).</p>}

      {done && (
        <div className="note note-ok">
          Version <strong>{done.version}</strong> créée comme candidat. Précision sur personnes jamais vues : {pct(done.test_accuracy)}.{' '}
          <button className="btn btn-link" onClick={() => go('models')}>Voir les versions</button>
          {done.warnings?.map((w) => <span key={w} className="warn-line">⚠ {w}</span>)}
        </div>
      )}
      {run.status === 'failed' && (
        <>
          <ErrorNote message={run.error ?? 'Échec de l\'entraînement.'} />
          {run.log_tail && <pre className="code">{run.log_tail}</pre>}
        </>
      )}
    </Section>
  )
}
