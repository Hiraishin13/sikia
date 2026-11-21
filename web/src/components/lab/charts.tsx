import { useEffect, useId, useState } from 'react'

/**
 * Graphiques sobres : un seul ton (encre), la différence entre séries passe par le trait (plein / pointillé)
 * et par des libellés écrits, jamais par la couleur seule. Chaque graphique a une vue tableau.
 */

export interface Series {
  name: string
  values: (number | null)[]
  dashed?: boolean
}

interface LineChartProps {
  title: string
  series: Series[]
  /** Étiquettes de l'axe horizontal (ex. numéros d'époque). */
  xs: (string | number)[]
  format?: (v: number) => string
  /** Bornes fixes de l'axe vertical (ex. 0 à 1 pour une précision). */
  yMin?: number
  yMax?: number
  xLabel?: string
}

const H = 220

/** Largeur réelle du conteneur : le graphique se redessine à sa taille, le texte garde donc une taille lisible. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    if (!el) return
    const update = () => setWidth(Math.max(260, Math.round(el.clientWidth)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

export function LineChart({ title, series, xs, format = (v) => v.toFixed(2), yMin, yMax, xLabel = 'Époque' }: LineChartProps) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [boxRef, W] = useWidth()
  const M = { top: 12, right: W < 420 ? 62 : 96, bottom: 30, left: 46 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  if (xs.length === 0 || all.length === 0) {
    return (
      <figure className="chart">
        <figcaption>{title}</figcaption>
        <p className="muted">Pas encore de données.</p>
      </figure>
    )
  }

  const lo = yMin ?? Math.min(...all)
  const hi = yMax ?? Math.max(...all)
  const pad = (hi - lo) * 0.08 || 0.5
  const y0 = yMin ?? lo - pad
  const y1 = yMax ?? hi + pad
  const x = (i: number) => M.left + (xs.length === 1 ? (W - M.left - M.right) / 2 : (i / (xs.length - 1)) * (W - M.left - M.right))
  const y = (v: number) => M.top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - M.top - M.bottom)
  const yTicks = [0, 1, 2, 3].map((k) => y0 + ((y1 - y0) * k) / 3)
  const xTickEvery = Math.max(1, Math.ceil(xs.length / 6))

  const path = (s: Series) => {
    let d = ''
    s.values.forEach((v, i) => {
      if (v === null) return
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const idx = Math.round(((px - M.left) / (W - M.left - M.right)) * (xs.length - 1))
    setHover(Math.min(xs.length - 1, Math.max(0, idx)))
  }

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <ul className="legend" aria-label="Légende">
        {series.map((s) => (
          <li key={s.name}>
            <svg width="28" height="10" aria-hidden>
              <line x1="0" y1="5" x2="28" y2="5" stroke={s.dashed ? 'var(--ink-2)' : 'var(--ink)'} strokeWidth="2" strokeDasharray={s.dashed ? '6 4' : undefined} />
            </svg>
            {s.name}
          </li>
        ))}
      </ul>
      <div ref={boxRef} className="chart-box">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="chart-svg"
        role="img"
        aria-labelledby={`${id}-t`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={`${id}-t`}>
          {title} : {series.map((s) => `${s.name} ${format(s.values.filter((v): v is number => v !== null).at(-1) ?? 0)}`).join(', ')}
        </title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">
              {format(t)}
            </text>
          </g>
        ))}
        {xs.map((label, i) =>
          i % xTickEvery === 0 || i === xs.length - 1 ? (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="chart-axis">
              {label}
            </text>
          ) : null,
        )}
        <text x={(M.left + W - M.right) / 2} y={H - 0} textAnchor="middle" className="chart-axis chart-axis-title">
          {xLabel}
        </text>

        {series.map((s) => (
          <path
            key={s.name}
            d={path(s)}
            fill="none"
            stroke={s.dashed ? 'var(--ink-2)' : 'var(--ink)'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? '6 4' : undefined}
          />
        ))}

        {/* Valeur finale écrite au bout de chaque courbe (texte en encre, jamais en couleur de série). */}
        {series.map((s) => {
          const last = s.values.map((v, i) => [v, i] as const).filter(([v]) => v !== null).at(-1)
          if (!last) return null
          const [v, i] = last
          return (
            <g key={s.name}>
              <circle cx={x(i)} cy={y(v as number)} r="4" fill={s.dashed ? 'var(--ink-2)' : 'var(--ink)'} stroke="var(--paper)" strokeWidth="2" />
              <text x={x(i) + 8} y={y(v as number) + 4} className="chart-end">
                {format(v as number)}
              </text>
            </g>
          )
        })}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="2 3" />
            {series.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] as number)} r="5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" />
              ) : null,
            )}
          </g>
        )}
      </svg>
      </div>

      {hover !== null && (
        <p className="chart-tip" role="status">
          {xLabel} {xs[hover]} · {series.map((s) => `${s.name} ${s.values[hover] == null ? '—' : format(s.values[hover] as number)}`).join(' · ')}
        </p>
      )}

      <details className="chart-table">
        <summary>Voir les valeurs en tableau</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{xLabel}</th>
                {series.map((s) => (
                  <th key={s.name}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((label, i) => (
                <tr key={i}>
                  <td>{label}</td>
                  {series.map((s) => (
                    <td key={s.name}>{s.values[i] == null ? '—' : format(s.values[i] as number)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

export interface BarItem {
  label: string
  /** Valeur entre 0 et `max`. */
  value: number
  /** Texte affiché à droite (la valeur écrite : la barre n'est qu'un repère). */
  text: string
  note?: string
}

/** Barres horizontales : étiquette, repère visuel, valeur écrite. */
export function BarList({ items, max, label }: { items: BarItem[]; max?: number; label: string }) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1e-9)
  if (items.length === 0) return <p className="muted">Rien à afficher.</p>
  return (
    <ul className="bars" aria-label={label}>
      {items.map((it) => (
        <li key={it.label} title={it.note}>
          <span className="bar-label">{it.label}</span>
          <span className="bar-track" aria-hidden>
            <span className="bar-fill" style={{ width: `${Math.round((Math.min(it.value, top) / top) * 100)}%` }} />
          </span>
          <span className="bar-value">{it.text}</span>
        </li>
      ))}
    </ul>
  )
}

interface ConfusionProps {
  labels: string[]
  matrix: number[][]
  /** Au-delà, on ne montre que les signes les plus confondus. */
  maxClasses?: number
}

/** Matrice de confusion : lignes = signe vrai, colonnes = signe prédit. Chaque case porte son nombre. */
export function ConfusionMatrix({ labels, matrix, maxClasses = 16 }: ConfusionProps) {
  const n = labels.length
  const errors = labels.map((_, i) => matrix[i].reduce((a, b, j) => a + (j === i ? 0 : b), 0) + matrix.reduce((a, row, j) => a + (j === i ? 0 : row[i]), 0))
  const keep = n <= maxClasses ? labels.map((_, i) => i) : [...labels.keys()].sort((a, b) => errors[b] - errors[a]).slice(0, maxClasses).sort((a, b) => a - b)
  if (n === 0) return <p className="muted">Pas de matrice (aucun exemple de test).</p>
  return (
    <div>
      {keep.length < n && (
        <p className="hintline">
          {n} signes : seuls les {keep.length} les plus confondus sont affichés.
        </p>
      )}
      <div className="table-scroll">
        <table className="confusion" aria-label="Matrice de confusion : lignes = signe vrai, colonnes = signe prédit">
          <thead>
            <tr>
              <th scope="col">vrai ↓ / prédit →</th>
              {keep.map((j) => (
                <th key={j} scope="col" className="conf-col">
                  {labels[j]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keep.map((i) => {
              const total = matrix[i].reduce((a, b) => a + b, 0) || 1
              return (
                <tr key={i}>
                  <th scope="row">{labels[i]}</th>
                  {keep.map((j) => {
                    const v = matrix[i][j]
                    const share = v / total
                    return (
                      <td
                        key={j}
                        className={i === j ? 'conf-diag' : v > 0 ? 'conf-err' : undefined}
                        style={{ background: v ? `color-mix(in srgb, var(--ink) ${Math.round(8 + share * 52)}%, transparent)` : undefined }}
                        title={`${labels[i]} reconnu comme ${labels[j]} : ${v} sur ${total}`}
                      >
                        {v || ''}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}
