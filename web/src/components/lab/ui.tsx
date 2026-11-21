import type { ReactNode } from 'react'
import { STATUS_LABEL } from '../../lib/lab'
import { Icon } from '../Icon'

/** Statut en texte (+ icône pour « en service ») : jamais la couleur seule. */
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status}`}>
      {status === 'active' && <Icon name="check" size={14} />}
      {status === 'failed' && <Icon name="alert" size={14} />}
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null
  return (
    <p className="error lab-error" role="alert">
      <Icon name="alert" size={16} /> {message}
    </p>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="lab-section">
      <div className="lab-section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}
