import { useAsync } from '../../hooks/useAsync'
import { MODE_LABEL, dateFr, lab, pct } from '../../lib/lab'
import type { Part } from './LabApp'
import { Badge, ErrorNote, Section, Stat } from './ui'

const CYCLE = ['Collecte', 'Annotation', 'Validation', 'Entraînement', 'Évaluation', 'Erreurs', 'Correction']

export function Overview({ go }: { go: (p: Part) => void }) {
  const { data, error, loading } = useAsync(() => lab.overview())
  if (loading && !data) return <p className="muted">Chargement…</p>
  if (!data) return <ErrorNote message={error} />
  const total = data.datasets.reduce((n, d) => n + (d.n_samples ?? 0), 0)
  const validated = data.datasets.reduce((n, d) => n + (d.n_validated ?? 0), 0)
  const m = data.active_model

  return (
    <>
      <Section title="Modèle en service">
        {m ? (
          <div className="stats">
            <Stat label="Version" value={m.version} note={MODE_LABEL[m.mode] ?? m.mode} />
            <Stat label="Précision sur personnes jamais vues" value={pct(m.accuracy)} note={`${m.n_test ?? 0} exemples de test`} />
            <Stat label="F1 moyen" value={pct(m.macro_f1)} />
            <Stat label="Mise en service" value={dateFr(m.created_at)} />
          </div>
        ) : (
          <p className="empty">
            Aucun modèle en service : l'application utilise des réponses <strong>factices</strong>. Entraînez une version,
            vérifiez-la, puis mettez-la en service.
          </p>
        )}
      </Section>

      <Section title="Données">
        <div className="stats">
          <Stat label="Jeux de données" value={data.datasets.length} />
          <Stat label="Exemples" value={total} note={`${validated} validés`} />
          <Stat label="À valider" value={data.to_review} note={data.to_review ? 'corrections et exemples sans label' : undefined} />
          <Stat label="Langues" value={data.sign_languages.length ? data.sign_languages.join(', ') : '—'} />
        </div>
        {data.datasets.some((d) => d.synthetic) && (
          <p className="note">
            Un jeu de données <strong>synthétique</strong> (signes fictifs) est présent : il sert à essayer le cycle, ses scores
            ne disent rien de la reconnaissance de vrais signes.
          </p>
        )}
        <div className="actions">
          <button className="btn btn-quiet" onClick={() => go('import')}>
            Importer des données
          </button>
          <button className="btn btn-quiet" onClick={() => go('review')}>
            Revoir les corrections
          </button>
        </div>
      </Section>

      <Section title="Derniers entraînements" aside={<button className="btn btn-link" onClick={() => go('train')}>Tout voir</button>}>
        {data.runs.length === 0 ? (
          <p className="empty">Aucun entraînement pour l'instant.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{dateFr(r.created_at)}</td>
                    <td>{MODE_LABEL[String(r.params.mode)] ?? '—'}</td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Le cycle d'amélioration">
        <ol className="cycle">
          {CYCLE.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="hintline">
          Un nouveau modèle n'en remplace jamais un autre automatiquement : il doit d'abord franchir une barrière de qualité,
          mesurée sur des personnes absentes de l'entraînement.
        </p>
      </Section>
    </>
  )
}
