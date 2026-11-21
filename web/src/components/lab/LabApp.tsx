import { useEffect, useState } from 'react'
import { LabError, lab, labToken, type Overview as OverviewData } from '../../lib/lab'
import { DataSection } from './DataSection'
import { ImportSection } from './ImportSection'
import { ModelsSection } from './ModelsSection'
import { Overview } from './Overview'
import { ReviewSection } from './ReviewSection'
import { TrainSection } from './TrainSection'
import { ErrorNote } from './ui'

export type Part = 'overview' | 'data' | 'import' | 'train' | 'models' | 'review'

const PARTS: { id: Part; label: string }[] = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'data', label: 'Données' },
  { id: 'import', label: 'Importer' },
  { id: 'train', label: 'Entraîner' },
  { id: 'models', label: 'Versions' },
  { id: 'review', label: 'Revue' },
]

type Access = 'checking' | 'ok' | 'denied' | 'disabled' | 'down'

export function LabApp() {
  const [access, setAccess] = useState<Access>('checking')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [part, setPart] = useState<Part>('overview')
  const [overview, setOverview] = useState<OverviewData | null>(null)

  const check = async () => {
    setAccess('checking')
    setError('')
    try {
      setOverview(await lab.overview())
      setAccess('ok')
    } catch (e) {
      if (e instanceof LabError && e.status === 404) setAccess('disabled')
      else if (e instanceof LabError && e.status === 401) {
        setAccess('denied')
        if (labToken.get()) setError('Jeton refusé.')
      } else if (e instanceof LabError && e.status === 0) setAccess('down')
      else {
        setAccess('denied')
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check()
  }, [])

  if (access === 'checking') return <p className="muted">Connexion au laboratoire…</p>

  if (access === 'disabled')
    return (
      <div className="lab-gate">
        <h2>Laboratoire désactivé</h2>
        <p className="lead">
          Le laboratoire peut lancer des calculs lourds et manipuler les données d'entraînement : il n'existe sur le
          serveur que si un jeton est défini. Dans <code>api/.env</code> :
        </p>
        <pre className="code">SIKIA_LAB_TOKEN=une-longue-phrase-secrète-d-au-moins-16-caractères</pre>
        <p className="lead">Redémarrez l'API, puis revenez ici et saisissez ce jeton.</p>
        <button className="btn btn-quiet" onClick={check}>
          Réessayer
        </button>
      </div>
    )

  if (access === 'down')
    return (
      <div className="lab-gate">
        <h2>Serveur injoignable</h2>
        <p className="lead">L'API ne répond pas. Vérifiez qu'elle tourne, puis réessayez.</p>
        <button className="btn btn-quiet" onClick={check}>
          Réessayer
        </button>
      </div>
    )

  if (access === 'denied')
    return (
      <form
        className="lab-gate"
        onSubmit={(e) => {
          e.preventDefault()
          labToken.set(token.trim())
          void check()
        }}
      >
        <h2>Laboratoire</h2>
        <p className="lead">Espace réservé à l'entraînement du modèle. Saisissez le jeton défini sur le serveur.</p>
        <label className="field">
          <span>Jeton</span>
          <input type="password" value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} />
        </label>
        <ErrorNote message={error} />
        <button className="btn btn-primary" disabled={token.trim().length < 8}>
          Entrer
        </button>
        <p className="hintline">Le jeton n'est gardé que pour la durée de cet onglet.</p>
      </form>
    )

  return (
    <div className="lab">
      <nav className="lab-nav" aria-label="Sections du laboratoire">
        {PARTS.map((p) => (
          <button key={p.id} aria-current={part === p.id ? 'page' : undefined} onClick={() => setPart(p.id)}>
            {p.label}
            {p.id === 'review' && overview && overview.to_review > 0 && <span className="count">{overview.to_review}</span>}
          </button>
        ))}
        <button
          className="lab-logout"
          onClick={() => {
            labToken.clear()
            setToken('')
            setAccess('denied')
          }}
        >
          Quitter
        </button>
      </nav>

      {part === 'overview' && <Overview go={setPart} />}
      {part === 'data' && <DataSection />}
      {part === 'import' && <ImportSection />}
      {part === 'train' && <TrainSection go={setPart} />}
      {part === 'models' && <ModelsSection />}
      {part === 'review' && <ReviewSection />}
    </div>
  )
}
