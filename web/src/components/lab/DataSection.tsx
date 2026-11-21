import { useMemo, useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { lab, pct, STATUS_LABEL, type Dataset, type Sample, type Stats } from '../../lib/lab'
import { BarList } from './charts'
import { KeypointPlayer } from './KeypointPlayer'
import { Badge, Empty, ErrorNote, Section, Stat } from './ui'

const ISSUE_LABEL: Record<string, string> = {
  trop_court: 'trop court',
  trop_long: 'trop long',
  mains_perdues: 'mains perdues',
  visage_absent: 'visage absent',
  suivi_instable: 'suivi instable',
}

const PAGE = 25

export function DataSection() {
  const datasets = useAsync(() => lab.datasets())
  const [scope, setScope] = useState<string[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [form, setForm] = useState({ name: '', sign_language: '', description: '' })
  const ids = scope.length ? scope : undefined
  const stats = useAsync(() => lab.stats(ids), [scope.join(',')])

  const toggle = (id: string) => setScope((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError('')
    setInfo('')
    try {
      await fn()
      if (done) setInfo(done)
      datasets.reload()
      stats.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Section title="Jeux de données">
        <ErrorNote message={error || datasets.error} />
        {info && <p className="note note-ok">{info}</p>}
        {datasets.data?.length === 0 && <Empty>Aucun jeu de données. Créez-en un ci-dessous, puis importez des exemples.</Empty>}
        <ul className="dataset-list">
          {datasets.data?.map((d: Dataset) => (
            <li key={d.id}>
              <label>
                <input type="checkbox" checked={scope.includes(d.id)} onChange={() => toggle(d.id)} />
                <span>
                  <strong>{d.name}</strong>
                  {d.synthetic && <span className="badge badge-synthetic">synthétique</span>}
                  {d.kind === 'improvement' && <span className="badge badge-archived">amélioration</span>}
                  <small>
                    {d.sign_language || 'langue non précisée'} · {d.n_samples ?? 0} exemples · {d.n_validated ?? 0} validés
                    {d.n_to_review ? ` · ${d.n_to_review} à revoir` : ''}
                  </small>
                </span>
              </label>
              <button
                className="btn btn-link"
                onClick={() => {
                  if (window.confirm(`Supprimer « ${d.name} » et ses ${d.n_samples ?? 0} exemples ? Cette action est définitive.`))
                    void run(() => lab.deleteDataset(d.id), 'Jeu de données supprimé.')
                }}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
        <p className="hintline">{scope.length ? `${scope.length} jeu(x) sélectionné(s) : les statistiques ci-dessous ne portent que sur eux.` : 'Aucune sélection : les statistiques portent sur tous les jeux.'}</p>

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => lab.createDataset(form), 'Jeu de données créé.').then(() => setForm({ name: '', sign_language: '', description: '' }))
          }}
        >
          <label className="field">
            <span>Nouveau jeu de données</span>
            <input value={form.name} placeholder="Nom" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Langue des signes</span>
            <input value={form.sign_language} placeholder="LSF, ASL, langue des signes congolaise…" onChange={(e) => setForm({ ...form, sign_language: e.target.value })} />
          </label>
          <button className="btn btn-quiet" disabled={!form.name.trim()}>
            Créer
          </button>
        </form>
      </Section>

      {stats.data && <StatsView stats={stats.data} ids={ids} onSplit={() => run(() => lab.assignSplits(ids ?? datasets.data?.map((d) => d.id) ?? []).then((r) => setInfo(`Séparation faite : ${Object.entries(r.by_split).map(([k, v]) => `${k} ${v}`).join(', ')}.${r.signer_independent ? '' : ' Attention : des exemples sans signeur, le score sera optimiste.'}`)))} />}

      <SamplesBrowser ids={ids} onChange={() => { stats.reload(); datasets.reload() }} />
    </>
  )
}

function StatsView({ stats, ids, onSplit }: { stats: Stats; ids?: string[]; onSplit: () => void }) {
  const [dups, setDups] = useState<{ label: string; a: string; b: string; distance: number }[] | null>(null)
  const [dupError, setDupError] = useState('')
  const signs = useMemo(() => Object.entries(stats.per_sign).sort((a, b) => a[1].count - b[1].count), [stats])
  const needed = stats.imbalance.recommended

  const toBars = (rec: Record<string, number>) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, text: String(value) }))

  return (
    <Section
      title="Statistiques"
      aside={
        <span className="actions-inline">
          <button className="btn btn-quiet" onClick={onSplit} title="Répartit les exemples validés par personne ; le jeu de test reste figé">
            Séparer train / val / test
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => lab.duplicates(ids).then(setDups, (e) => setDupError(String(e.message ?? e)))}
          >
            Chercher les doublons
          </button>
        </span>
      }
    >
      <div className="stats">
        <Stat label="Exemples" value={stats.samples} />
        <Stat label="Images" value={stats.images} />
        <Stat label="Vidéos" value={stats.videos} />
        <Stat label="Signes" value={stats.signs} />
        <Stat label="Personnes" value={stats.signers} />
        <Stat label="Qualité moyenne" value={pct(stats.quality.mean, 0)} note={`${stats.quality.low} de mauvaise qualité`} />
        <Stat label="Signes statiques" value={stats.static_samples} />
      </div>

      <h3>Ce qui manque ou déséquilibre les données</h3>
      <ul className="checks">
        <Check ok={stats.imbalance.underrepresented.length === 0} title={`Signes avec moins de ${needed.examples_per_sign} exemples`}
          detail={stats.imbalance.underrepresented.join(', ')} />
        <Check ok={stats.imbalance.few_signers.length === 0} title={`Signes faits par moins de ${needed.signers_per_sign} personnes`}
          detail={stats.imbalance.few_signers.join(', ') + ' — le modèle risque d\'apprendre la personne, pas le signe'} />
        <Check ok={stats.imbalance.ratio <= 3} title={`Déséquilibre entre signes : ×${stats.imbalance.ratio}`}
          detail={`de ${stats.imbalance.min} à ${stats.imbalance.max} exemples par signe`} />
        <Check ok={stats.missing.no_signer === 0} title="Exemples sans personne indiquée" detail={`${stats.missing.no_signer} exemples : impossible de tester sur des inconnus`} />
        <Check ok={stats.missing.no_language === 0} title="Exemples sans langue indiquée" detail={`${stats.missing.no_language} exemples`} />
        <Check ok={stats.missing.no_label === 0} title="Exemples sans label" detail={`${stats.missing.no_label} exemples à annoter`} />
        <Check ok={stats.quality.low === 0} title="Exemples de mauvaise qualité"
          detail={Object.entries(stats.quality.issues).map(([k, v]) => `${ISSUE_LABEL[k] ?? k} : ${v}`).join(' · ')} />
      </ul>

      <div className="grid-2">
        <div>
          <h3>Par langue</h3>
          <BarList label="Exemples par langue" items={toBars(stats.by_language)} />
          <h3>Par jeu de données</h3>
          <BarList label="Exemples par jeu de données" items={toBars(stats.by_dataset)} />
        </div>
        <div>
          <h3>Par statut</h3>
          <BarList label="Exemples par statut" items={toBars(stats.by_status).map((b) => ({ ...b, label: STATUS_LABEL[b.label] ?? b.label }))} />
          <h3>Séparation (exemples validés)</h3>
          <BarList label="Exemples par séparation" items={toBars(stats.by_split)} />
        </div>
      </div>

      <h3>Diversité des conditions de capture</h3>
      <p className="hintline">Part des exemples où la condition est renseignée. Un modèle entraîné sur une seule caméra, un seul éclairage ou un seul fond ne généralise pas.</p>
      <BarList
        label="Métadonnées renseignées"
        max={1}
        items={Object.entries(stats.diversity.metadata_coverage).map(([k, v]) => ({
          label: ({ camera: 'Caméra', lighting: 'Éclairage', background: 'Arrière-plan', distance: 'Distance' } as Record<string, string>)[k] ?? k,
          value: v,
          text: pct(v, 0),
        }))}
      />

      <h3>Exemples par signe</h3>
      {signs.length === 0 ? (
        <Empty>Aucun exemple validé avec un label.</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Signe</th>
                <th>Exemples</th>
                <th>Personnes</th>
                <th>Qualité</th>
                <th>Langues</th>
                <th>Variantes</th>
                <th>Train / val / test</th>
              </tr>
            </thead>
            <tbody>
              {signs.map(([label, s]) => (
                <tr key={label}>
                  <td>
                    <strong>{label}</strong>
                  </td>
                  <td className={s.count < needed.examples_per_sign ? 'cell-warn' : undefined}>{s.count}</td>
                  <td className={s.signers < needed.signers_per_sign ? 'cell-warn' : undefined}>{s.signers}</td>
                  <td>{pct(s.mean_quality, 0)}</td>
                  <td>{s.languages.join(', ') || '—'}</td>
                  <td>{s.variants.join(', ') || '—'}</td>
                  <td>
                    {s.splits.train ?? 0} / {s.splits.val ?? 0} / {s.splits.test ?? 0}
                    {s.splits['non réparti'] ? ` (+${s.splits['non réparti']} non réparti)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dupError && <ErrorNote message={dupError} />}
      {dups && (
        <>
          <h3>Doublons probables</h3>
          {dups.length === 0 ? (
            <Empty>Aucun doublon proche détecté.</Empty>
          ) : (
            <ul className="plain">
              {dups.slice(0, 30).map((d) => (
                <li key={d.a + d.b}>
                  <strong>{d.label}</strong> : <code>{d.a}</code> et <code>{d.b}</code> (distance {d.distance})
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  )
}

function Check({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <li className={ok ? 'check-ok' : 'check-warn'}>
      <span className="check-mark" aria-hidden>
        {ok ? '✓' : '!'}
      </span>
      <span>
        <strong>{title}</strong>
        <span className="sr-only">{ok ? ' : correct' : ' : à corriger'}</span>
        {!ok && detail && <small>{detail}</small>}
      </span>
    </li>
  )
}

function SamplesBrowser({ ids, onChange }: { ids?: string[]; onChange: () => void }) {
  const [filters, setFilters] = useState({ search: '', status: '', split: '', language: '', issue: '', media: '' })
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const q = { dataset_ids: ids, ...filters, limit: PAGE, offset: page * PAGE }
  const list = useAsync(() => lab.samples(q), [ids?.join(','), JSON.stringify(filters), page])

  const set = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v })
    setPage(0)
  }
  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      list.reload()
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const total = list.data?.total ?? 0
  return (
    <Section title="Exemples">
      <div className="filters">
        <label className="field"><span>Recherche</span><input value={filters.search} placeholder="signe, personne, variante…" onChange={(e) => set('search', e.target.value)} /></label>
        <label className="field"><span>Statut</span>
          <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(STATUS_LABEL).filter(([k]) => ['validated', 'pending', 'unlabeled', 'rejected'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="field"><span>Séparation</span>
          <select value={filters.split} onChange={(e) => set('split', e.target.value)}>
            <option value="">Toutes</option><option value="train">Entraînement</option><option value="val">Validation</option><option value="test">Test</option>
          </select></label>
        <label className="field"><span>Média</span>
          <select value={filters.media} onChange={(e) => set('media', e.target.value)}>
            <option value="">Tous</option><option value="recording">Enregistrement</option><option value="image">Image</option><option value="video">Vidéo</option><option value="feedback">Retour utilisateur</option><option value="import">Import</option><option value="synthetic">Synthétique</option>
          </select></label>
        <label className="field"><span>Problème de qualité</span>
          <select value={filters.issue} onChange={(e) => set('issue', e.target.value)}>
            <option value="">Aucun filtre</option>
            {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="field"><span>Langue</span><input value={filters.language} placeholder="LSF" onChange={(e) => set('language', e.target.value)} /></label>
      </div>

      <ErrorNote message={error || list.error} />
      {list.data && list.data.items.length === 0 && <Empty>Aucun exemple ne correspond.</Empty>}
      {list.data && list.data.items.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Signe</th><th>Personne</th><th>Langue</th><th>Statut</th><th>Séparation</th><th>Qualité</th><th>Durée</th><th /></tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <SampleRow key={s.id} s={s} open={openId === s.id} onOpen={() => setOpenId(openId === s.id ? null : s.id)} act={act} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <button className="btn btn-quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</button>
        <span>{total === 0 ? '0' : `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)}`} sur {total}</span>
        <button className="btn btn-quiet" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Suivant</button>
      </div>
    </Section>
  )
}

function SampleRow({ s, open, onOpen, act }: { s: Sample; open: boolean; onOpen: () => void; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [label, setLabel] = useState(s.label)
  return (
    <>
      <tr>
        <td>
          <input aria-label="Signe" className="cell-input" value={label} placeholder="à annoter" onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim().toUpperCase() !== s.label && void act(() => lab.patchSample(s.id, { label }))} />
        </td>
        <td>{s.signer || '—'}</td>
        <td>{s.language || '—'}</td>
        <td><Badge status={s.status} /></td>
        <td>{s.split ?? '—'}</td>
        <td>
          {pct(s.quality, 0)}
          {s.issues.length > 0 && <small className="cell-note">{s.issues.map((i) => ISSUE_LABEL[i] ?? i).join(', ')}</small>}
        </td>
        <td>{s.duration_s.toFixed(1)} s{s.static ? ' · statique' : ''}</td>
        <td className="row-actions">
          <button className="btn btn-link" onClick={onOpen} aria-expanded={open}>{open ? 'Masquer' : 'Voir'}</button>
          {s.status !== 'rejected' && <button className="btn btn-link" onClick={() => void act(() => lab.patchSample(s.id, { status: 'rejected' }))}>Rejeter</button>}
          {s.status !== 'validated' && s.label && <button className="btn btn-link" onClick={() => void act(() => lab.patchSample(s.id, { status: 'validated' }))}>Valider</button>}
          <button className="btn btn-link" onClick={() => window.confirm('Supprimer cet exemple définitivement ?') && void act(() => lab.deleteSample(s.id))}>Supprimer</button>
        </td>
      </tr>
      {open && (
        <tr className="row-detail">
          <td colSpan={8}>
            <KeypointPlayer sampleId={s.id} />
            <p className="hintline">
              {s.n_frames} images · média : {s.media}
              {Object.keys(s.meta).length ? ' · ' + Object.entries(s.meta).filter(([k]) => k !== 'source_name').map(([k, v]) => `${k} : ${String(v)}`).join(' · ') : ''}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}
