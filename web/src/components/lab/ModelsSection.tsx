import { useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { LabError, MODE_LABEL, dateFr, duration, lab, pct, type Comparison, type Evaluation, type Gate, type ModelCard, type ModelFull } from '../../lib/lab'
import { BarList, ConfusionMatrix, LineChart } from './charts'
import { Badge, Empty, ErrorNote, Section, Stat } from './ui'

export function ModelsSection() {
  const models = useAsync(() => lab.models())
  const datasets = useAsync(() => lab.datasets())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [pair, setPair] = useState<{ a: string; b: string }>({ a: '', b: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const list = models.data ?? []
  const byDate = [...list].sort((a, b) => a.created_at - b.created_at)
  const active = list.find((m) => m.status === 'active')

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError('')
    setInfo('')
    try {
      await fn()
      setInfo(done)
      models.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Section
        title="Versions du modèle"
        aside={
          <button className="btn btn-quiet" onClick={() => window.confirm('Revenir à la version qui était en service avant celle-ci ?') && void run(() => lab.rollback(), 'Retour à la version précédente.')}>
            Retour arrière
          </button>
        }
      >
        <ErrorNote message={error || models.error} />
        {info && <p className="note note-ok">{info}</p>}
        {list.length === 0 && <Empty>Aucune version. Lancez un entraînement : il créera la version v1.0.</Empty>}

        {byDate.length > 0 && (
          <LineChart
            title="Précision par version (personnes jamais vues)"
            xs={byDate.map((m) => m.version)}
            xLabel="Version"
            yMin={0}
            yMax={1}
            format={(v) => pct(v, 0)}
            series={[{ name: 'Précision', values: byDate.map((m) => m.accuracy) }]}
          />
        )}

        {list.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Comparer</th><th>Version</th><th>Statut</th><th>Type</th><th>Précision</th><th>F1</th><th>Test</th><th>Appris sur</th><th>Durée</th><th>Date</th><th /></tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className={m.status === 'active' ? 'row-on' : undefined}>
                    <td className="cmp">
                      <label><input type="radio" name="cmp-a" checked={pair.a === m.id} onChange={() => setPair({ ...pair, a: m.id })} /> A</label>
                      <label><input type="radio" name="cmp-b" checked={pair.b === m.id} onChange={() => setPair({ ...pair, b: m.id })} /> B</label>
                    </td>
                    <td><strong>{m.version}</strong>{m.name && m.name !== m.version ? <small className="cell-note">{m.name}</small> : null}</td>
                    <td><Badge status={m.status} /></td>
                    <td>{MODE_LABEL[m.mode] ?? m.mode}</td>
                    <td>{pct(m.accuracy)}</td>
                    <td>{pct(m.macro_f1)}</td>
                    <td>{m.n_test ?? 0}</td>
                    <td>{m.n_train}</td>
                    <td>{duration(m.duration_s)}</td>
                    <td>{dateFr(m.created_at)}</td>
                    <td className="row-actions">
                      <button className="btn btn-link" onClick={() => setDetailId(detailId === m.id ? null : m.id)}>{detailId === m.id ? 'Masquer' : 'Détails'}</button>
                      {m.status !== 'rejected' && m.status !== 'active' && <button className="btn btn-link" onClick={() => setDetailId(m.id)}>Mise en service…</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {active && <p className="hintline">En service : <strong>{active.version}</strong>. Les autres versions restent des candidats ou des archives.</p>}
      </Section>

      {pair.a && pair.b && pair.a !== pair.b && <Compare a={pair.a} b={pair.b} />}
      {detailId && (
        <Detail
          key={detailId}
          id={detailId}
          card={list.find((m) => m.id === detailId)}
          datasetIds={datasets.data?.map((d) => d.id) ?? []}
          changed={() => models.reload()}
        />
      )}
    </>
  )
}

function Delta({ v }: { v: number }) {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return <span>{sign}{Math.abs(v * 100).toFixed(1).replace('.', ',')} pt</span>
}

function Compare({ a, b }: { a: string; b: string }) {
  const cmp = useAsync(() => lab.compare(a, b), [a, b])
  if (cmp.error) return <Section title="Comparaison"><ErrorNote message={cmp.error} /></Section>
  const c: Comparison | null = cmp.data
  if (!c) return <Section title="Comparaison"><p className="muted">Chargement…</p></Section>
  const row = (label: string, fa: string, fb: string) => (
    <tr><th scope="row">{label}</th><td>{fa}</td><td>{fb}</td></tr>
  )
  return (
    <Section title={`Comparaison : ${c.a.version} → ${c.b.version}`}>
      {!c.same_test_set && (
        <p className="note"><strong>Jeux de test différents</strong> : les scores ne sont pas comparables tels quels. Utilisez « Réévaluer sur le jeu de test actuel » sur chaque version.</p>
      )}
      <div className="table-scroll">
        <table>
          <thead><tr><th /><th>A : {c.a.version}</th><th>B : {c.b.version}</th></tr></thead>
          <tbody>
            {row('Précision (personnes jamais vues)', pct(c.a.accuracy), pct(c.b.accuracy))}
            {row('F1 moyen', pct(c.a.macro_f1), pct(c.b.macro_f1))}
            {row('Confiance moyenne', pct(c.a.mean_confidence), pct(c.b.mean_confidence))}
            {row('Exemples de test', String(c.a.n_test ?? 0), String(c.b.n_test ?? 0))}
            {row("Exemples d'entraînement", String(c.a.n_train), String(c.b.n_train))}
            {row('Type', MODE_LABEL[c.a.mode] ?? c.a.mode, MODE_LABEL[c.b.mode] ?? c.b.mode)}
            {row("Durée d'entraînement", duration(c.a.duration_s), duration(c.b.duration_s))}
            {row('Date', dateFr(c.a.created_at), dateFr(c.b.created_at))}
          </tbody>
        </table>
      </div>
      {c.per_class && (
        <>
          <p><strong>Écart de précision : <Delta v={c.per_class.accuracy_delta} /></strong> · F1 moyen : <Delta v={c.per_class.macro_f1_delta} /></p>
          <div className="grid-2">
            <div>
              <h3>Signes qui progressent</h3>
              {c.per_class.improved.length === 0 ? <Empty>Aucun.</Empty> :
                <BarList label="Signes qui progressent" max={1} items={c.per_class.improved.slice(0, 10).map((d) => ({ label: d.label, value: d.delta, text: `+${(d.delta * 100).toFixed(0)} pt`, note: `F1 ${pct(d.f1_old, 0)} → ${pct(d.f1_new, 0)}` }))} />}
            </div>
            <div>
              <h3>Signes qui régressent</h3>
              {c.per_class.regressed.length === 0 ? <Empty>Aucun.</Empty> :
                <BarList label="Signes qui régressent" max={1} items={c.per_class.regressed.slice(0, 10).map((d) => ({ label: d.label, value: -d.delta, text: `−${(-d.delta * 100).toFixed(0)} pt`, note: `F1 ${pct(d.f1_old, 0)} → ${pct(d.f1_new, 0)}` }))} />}
            </div>
          </div>
        </>
      )}
      <h3>La version B peut-elle remplacer A ?</h3>
      <GateView gate={c.gate} />
    </Section>
  )
}

function GateView({ gate }: { gate: Gate }) {
  return (
    <>
      <ul className="checks">
        {gate.checks.map((k) => (
          <li key={k.name} className={k.ok ? 'check-ok' : 'check-warn'}>
            <span className="check-mark" aria-hidden>{k.ok ? '✓' : '✗'}</span>
            <span><strong>{k.name}</strong><span className="sr-only">{k.ok ? ' : franchi' : ' : non franchi'}</span><small>{k.detail}</small></span>
          </li>
        ))}
      </ul>
      <p className={gate.ok ? 'note note-ok' : 'note'}>{gate.ok ? 'Barrière franchie : la mise en service est possible.' : 'Barrière non franchie : la mise en service est bloquée.'}</p>
    </>
  )
}

function Detail({ id, card, datasetIds, changed }: { id: string; card?: ModelCard; datasetIds: string[]; changed: () => void }) {
  const model = useAsync(() => lab.model(id), [id])
  const gate = useAsync(() => lab.gate(id), [id])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [force, setForce] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const m: ModelFull | null = model.data
  if (model.error) return <Section title="Détails"><ErrorNote message={model.error} /></Section>
  if (!m) return <Section title="Détails"><p className="muted">Chargement…</p></Section>

  const test: Evaluation | undefined = m.metrics?.test
  const val: Evaluation | undefined = m.metrics?.val
  const cal = m.metrics?.calibration
  const history = m.metrics?.history ?? []
  const perClass = Object.entries(test?.per_class ?? {}).sort((a, b) => a[1].f1 - b[1].f1)

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      await fn()
      setInfo(done)
      changed()
      model.reload()
      gate.reload()
    } catch (e) {
      // Une promotion refusée porte le détail de la barrière : on le montre tel quel.
      setError(e instanceof LabError ? e.message : e instanceof Error ? e.message : String(e))
      gate.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={`Version ${m.version}`}>
      <ErrorNote message={error} />
      {info && <p className="note note-ok">{info}</p>}
      <div className="stats">
        <Stat label="Statut" value={<Badge status={m.status} />} note={MODE_LABEL[m.mode]} />
        <Stat label="Précision" value={pct(test?.accuracy)} note={`sur ${test?.n ?? 0} exemples de test`} />
        <Stat label="F1 moyen" value={pct(test?.macro?.f1)} />
        <Stat label="Taux d'erreur" value={pct(test?.error_rate)} />
      </div>

      {!m.metrics?.signer_independent && <p className="note"><strong>Score optimiste</strong> : certains exemples n'ont pas de personne indiquée, ou il y a moins de 2 personnes. Cette version ne peut pas être mise en service sans forcer.</p>}
      {m.metrics?.warnings?.map((w) => <p key={w} className="note">⚠ {w}</p>)}

      <h3>Mise en service</h3>
      {gate.data && <GateView gate={gate.data} />}
      {m.status !== 'active' && m.status !== 'rejected' && (
        <div className="promo">
          <div className="actions">
            <button className="btn btn-primary" disabled={busy || !gate.data?.ok} onClick={() => window.confirm(`Mettre la version ${m.version} en service ? L'application l'utilisera immédiatement.`) && void act(() => lab.activate(m.id), `La version ${m.version} est en service.`)}>
              Mettre en service
            </button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => void act(() => lab.evaluate(m.id, datasetIds), 'Réévaluée sur le jeu de test actuel.')}>Réévaluer sur le jeu de test actuel</button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => window.confirm('Rejeter cette version ?') && void act(() => lab.rejectModel(m.id), 'Version rejetée.')}>Rejeter</button>
          </div>
          {!gate.data?.ok && (
            <details className="advanced" open={force} onToggle={(e) => setForce((e.target as HTMLDetailsElement).open)}>
              <summary>Forcer la mise en service malgré la barrière</summary>
              <p className="hintline">Déconseillé : une version non validée peut dégrader la reconnaissance pour tout le monde. La raison est conservée dans l'historique.</p>
              <label className="field"><span>Raison (10 caractères au moins)</span>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <button className="btn btn-stop" disabled={busy || reason.trim().length < 10}
                onClick={() => window.confirm('Forcer la mise en service de cette version ?') && void act(() => lab.activate(m.id, true, reason), `Version ${m.version} mise en service de force.`)}>
                Forcer la mise en service
              </button>
            </details>
          )}
        </div>
      )}

      <h3>Métriques sur des personnes jamais vues</h3>
      {test && test.n > 0 ? (
        <>
          <div className="stats">
            <Stat label="Précision (macro)" value={pct(test.macro?.precision)} />
            <Stat label="Rappel (macro)" value={pct(test.macro?.recall)} />
            <Stat label="F1 (macro)" value={pct(test.macro?.f1)} />
            <Stat label="F1 pondéré" value={pct(test.weighted?.f1)} />
            <Stat label="Top-3" value={pct(test.top3_accuracy)} />
            <Stat label="Confiance moyenne" value={pct(test.mean_confidence)} note={`juste ${pct(test.mean_confidence_correct, 0)} · fausse ${pct(test.mean_confidence_wrong, 0)}`} />
          </div>
          {val && <p className="hintline">Sur la validation (utilisée pour choisir l'arrêt, donc moins fiable) : {pct(val.accuracy)}.</p>}
          {cal && (
            <p className="hintline">
              Seuil « signe non reconnu » : <strong>{cal.reached ? pct(cal.threshold, 0) : 'aucun'}</strong>
              {cal.reached ? ` — au-dessus, ${pct(cal.precision, 0)} de réponses justes sur la validation, en répondant à ${pct(cal.coverage, 0)} des signes.` : ' — la précision visée est inatteignable.'}
              {test.abstention ? ` Sur le test : ${pct(test.abstention.precision, 0)} de réponses justes, ${test.abstention.abstained} signes refusés.` : ''}
            </p>
          )}
          <div className="grid-2">
            <div>
              <h3>Signes les plus difficiles</h3>
              <BarList label="Signes les plus difficiles (F1)" max={1} items={(test.hardest_signs ?? []).slice(0, 8).map((s) => ({ label: s.label, value: s.f1, text: pct(s.f1, 0), note: `${s.support} exemples de test` }))} />
              <h3>Confusions fréquentes</h3>
              {(test.top_confusions ?? []).length === 0 ? <Empty>Aucune confusion.</Empty> : (
                <ul className="plain">{test.top_confusions!.slice(0, 6).map((c) => <li key={c.true + c.predicted}><strong>{c.true}</strong> reconnu comme <strong>{c.predicted}</strong> ({c.count} fois)</li>)}</ul>
              )}
            </div>
            <div>
              <h3>Par langue</h3>
              <BarList label="Précision par langue" max={1} items={Object.entries(test.by_language ?? {}).map(([k, v]) => ({ label: k, value: v.accuracy, text: `${pct(v.accuracy, 0)} (${v.n})` }))} />
              <h3>Par jeu de données</h3>
              <BarList label="Précision par jeu de données" max={1} items={Object.entries(test.by_dataset ?? {}).map(([k, v]) => ({ label: k, value: v.accuracy, text: `${pct(v.accuracy, 0)} (${v.n})` }))} />
              <h3>Par personne</h3>
              <BarList label="Précision par personne" max={1} items={Object.entries(test.by_signer ?? {}).map(([k, v]) => ({ label: k, value: v.accuracy, text: `${pct(v.accuracy, 0)} (${v.n})` }))} />
            </div>
          </div>
          <h3>Précision et rappel par signe</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Signe</th><th>Précision</th><th>Rappel</th><th>F1</th><th>Exemples de test</th></tr></thead>
              <tbody>{perClass.map(([label, c]) => <tr key={label}><td><strong>{label}</strong></td><td>{pct(c.precision, 0)}</td><td>{pct(c.recall, 0)}</td><td>{pct(c.f1, 0)}</td><td>{c.support}</td></tr>)}</tbody>
            </table>
          </div>
          <h3>Matrice de confusion</h3>
          <ConfusionMatrix labels={test.labels ?? []} matrix={test.confusion ?? []} />
        </>
      ) : (
        <Empty>Aucun exemple de test : ajoutez des exemples de personnes différentes, séparez les données, puis réévaluez.</Empty>
      )}

      {history.length > 0 && (
        <LineChart title="Courbes de l'entraînement" xs={history.map((e) => e.epoch ?? 0)} yMin={0} yMax={1} format={(v) => pct(v, 0)}
          series={[{ name: 'F1 validation', values: history.map((e) => e.val_macro_f1 ?? null) }, { name: 'Précision validation', values: history.map((e) => e.val_accuracy ?? null), dashed: true }]} />
      )}

      <h3>Fiche</h3>
      <dl className="facts">
        <dt>Jeux de données</dt><dd>{m.dataset_ids.length}</dd>
        <dt>Exemples d'entraînement</dt><dd>{m.n_train}{m.metrics?.train?.replayed ? ` dont ${m.metrics.train.replayed} rejoués` : ''}</dd>
        <dt>Signes</dt><dd>{m.metrics?.train?.classes ?? '—'}</dd>
        <dt>Durée</dt><dd>{duration(m.duration_s)}</dd>
        <dt>Paramètres</dt><dd><code>{JSON.stringify(m.params, (k, v) => (k === 'dataset_ids' || k === 'model' ? undefined : v))}</code></dd>
        <dt>Version de départ</dt><dd>{card?.mode === 'initial' ? '—' : String((m.params as Record<string, unknown>).base_model_id ?? '—')}</dd>
      </dl>
    </Section>
  )
}
