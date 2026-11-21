import { useRef, useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { lab } from '../../lib/lab'
import { Clock, deriveLabel, extractImage, extractVideo, isImage, isVideo, type Extracted, type LabelMode } from '../../lib/mediaImport'
import { createTracker, type Tracker } from '../../lib/tracker'
import { Empty, ErrorNote, Section } from './ui'

interface Result {
  added: number
  duplicates: number
  rejected: { source: string; reason: string }[]
}
const emptyResult = (): Result => ({ added: 0, duplicates: 0, rejected: [] })

export function ImportSection() {
  const datasets = useAsync(() => lab.datasets())
  const [datasetId, setDatasetId] = useState('')
  const dataset = datasetId || datasets.data?.[0]?.id || ''

  if (datasets.data && datasets.data.length === 0)
    return (
      <Section title="Importer">
        <Empty>Créez d'abord un jeu de données dans l'onglet « Données ».</Empty>
      </Section>
    )

  return (
    <>
      <Section title="Importer des données">
        <label className="field">
          <span>Jeu de données de destination</span>
          <select value={dataset} onChange={(e) => setDatasetId(e.target.value)}>
            {datasets.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hintline">
          Seuls des <strong>points clés</strong> sont conservés : les images et les vidéos sont analysées dans votre navigateur
          puis jetées, elles ne sont jamais envoyées.
        </p>
      </Section>
      <MediaImport datasetId={dataset} />
      <JsonImport datasetId={dataset} />
      <CsvImport datasetId={dataset} />
    </>
  )
}

function Summary({ r }: { r: Result }) {
  return (
    <div className="note note-ok">
      {r.added} ajouté(s), {r.duplicates} doublon(s) ignoré(s), {r.rejected.length} rejeté(s).
      {r.rejected.length > 0 && (
        <ul className="plain">
          {r.rejected.slice(0, 20).map((x) => (
            <li key={x.source}>
              <strong>{x.source}</strong> : {x.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const readText = (f: File) => f.text()

function JsonImport({ datasetId }: { datasetId: string }) {
  const [meta, setMeta] = useState({ language: '', signer: '', variant: '' })
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError('')
    const total = emptyResult()
    try {
      const docs: unknown[] = []
      for (const f of Array.from(files)) {
        try {
          const parsed = JSON.parse(await readText(f))
          docs.push({ ...parsed, source_name: parsed.source_name ?? f.name })
        } catch {
          total.rejected.push({ source: f.name, reason: "ce n'est pas du JSON valide" })
        }
      }
      for (let i = 0; i < docs.length; i += 20) {
        const r = await lab.importRecordings(datasetId, { recordings: docs.slice(i, i + 20), ...meta })
        total.added += r.added.length
        total.duplicates += r.duplicates.length
        total.rejected.push(...r.rejected)
      }
      setResult(total)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Enregistrements de l'application (JSON)">
      <p className="lead">Les fichiers exportés depuis l'onglet « Contribuer ». Le signe et la personne sont lus dans le fichier ; les champs ci-dessous ne servent que par défaut.</p>
      <div className="params">
        <label className="field"><span>Langue des signes</span><input value={meta.language} placeholder="LSF, ASL…" onChange={(e) => setMeta({ ...meta, language: e.target.value })} /></label>
        <label className="field"><span>Personne par défaut</span><input value={meta.signer} placeholder="pseudo" onChange={(e) => setMeta({ ...meta, signer: e.target.value })} /></label>
        <label className="field"><span>Variante</span><input value={meta.variant} onChange={(e) => setMeta({ ...meta, variant: e.target.value })} /></label>
      </div>
      <label className="field"><span>Fichiers .json (plusieurs possibles)</span>
        <input type="file" accept=".json,application/json" multiple disabled={busy || !datasetId} onChange={(e) => void onFiles(e.target.files)} /></label>
      {busy && <p className="muted">Import en cours…</p>}
      <ErrorNote message={error} />
      {result && <Summary r={result} />}
    </Section>
  )
}

function CsvImport({ datasetId }: { datasetId: string }) {
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const onFile = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    setResult('')
    try {
      const r = await lab.importMetadata(datasetId, await readText(files[0]))
      setResult(`${r.updated} exemple(s) mis à jour.${r.not_found.length ? ` Introuvables : ${r.not_found.slice(0, 10).join(', ')}${r.not_found.length > 10 ? '…' : ''}.` : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Section title="Labels et métadonnées (CSV)">
      <p className="lead">
        Pour annoter ou corriger en masse des exemples déjà importés. Le CSV doit avoir une colonne <code>fichier</code> (ou{' '}
        <code>id</code>), et au choix <code>signe</code>, <code>langue</code>, <code>personne</code>, <code>variante</code>,{' '}
        <code>statut</code>. Séparateur : virgule ou point-virgule.
      </p>
      <label className="field"><span>Fichier .csv</span><input type="file" accept=".csv,text/csv" disabled={!datasetId} onChange={(e) => void onFile(e.target.files)} /></label>
      <ErrorNote message={error} />
      {result && <p className="note note-ok">{result}</p>}
    </Section>
  )
}

interface Pending {
  file: string
  extracted: Extracted
  label: string
  segments: { start: number; end: number; label: string }[]
}

function MediaImport({ datasetId }: { datasetId: string }) {
  const [mode, setMode] = useState<LabelMode>('folder')
  const [fixed, setFixed] = useState('')
  const [fps, setFps] = useState(30)
  const [autoSegment, setAutoSegment] = useState(true)
  const [meta, setMeta] = useState({ language: '', signer: '', variant: '', camera: '', lighting: '', background: '', distance: '' })
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)
  const tracker = useRef<Tracker | null>(null)

  const post = async (docs: Record<string, unknown>[], total: Result) => {
    if (!docs.length) return
    const r = await lab.importRecordings(datasetId, {
      recordings: docs, language: meta.language, signer: meta.signer, variant: meta.variant,
    })
    total.added += r.added.length
    total.duplicates += r.duplicates.length
    total.rejected.push(...r.rejected)
  }

  const run = async (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).filter((f) => isImage(f) || isVideo(f))
    if (!list.length) {
      setError('Aucune image ni vidéo reconnue parmi ces fichiers.')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    cancelled.current = false
    const total = emptyResult()
    const toSend: Record<string, unknown>[] = []
    const toReview: Pending[] = []
    const extra = {
      meta: Object.fromEntries(Object.entries({ camera: meta.camera, lighting: meta.lighting, background: meta.background, distance: meta.distance }).filter(([, v]) => v.trim())),
    }
    try {
      setProgress({ label: 'Chargement du suivi des mains…', done: 0, total: list.length })
      tracker.current ??= await createTracker({ faceStride: 1 })
      const clock = new Clock()

      for (let i = 0; i < list.length; i++) {
        if (cancelled.current) break
        const file = list[i]
        const label = deriveLabel(file, mode, fixed)
        setProgress({ label: file.name, done: i, total: list.length })
        try {
          const ex = isImage(file)
            ? await extractImage(file, tracker.current, clock, extra)
            : await extractVideo(file, tracker.current, clock, {
                fps, maxSeconds: 120, isCancelled: () => cancelled.current,
                onProgress: (d, t) => setProgress({ label: `${file.name} (${d}/${t} images)`, done: i, total: list.length }),
              }, extra)
          if (ex.warning && isImage(file)) {
            total.rejected.push({ source: file.name, reason: ex.warning })
            continue
          }
          const doc = { ...ex.doc, label }
          if (isVideo(file) && autoSegment) {
            const seg = await lab.segment(doc).catch(() => null)
            if (seg && (seg.segments.length > 1 || (seg.segments.length === 1 && seg.n_frames / fps > 6))) {
              toReview.push({ file: file.name, extracted: ex, label, segments: seg.segments.map((s) => ({ ...s, label })) })
              continue
            }
          }
          if (ex.warning) total.rejected.push({ source: file.name, reason: ex.warning })
          else toSend.push(doc)
        } catch (e) {
          total.rejected.push({ source: file.name, reason: e instanceof Error ? e.message : String(e) })
        }
        if (toSend.length >= 10) await post(toSend.splice(0), total)
      }
      await post(toSend, total)
      setResult(total)
      setPending(toReview)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const confirm = async (p: Pending) => {
    const chosen = p.segments.filter((s) => s.end > s.start)
    const total = emptyResult()
    try {
      await post([{ ...p.extracted.doc, label: p.label, segments: chosen.map((s) => [s.start, s.end, s.label]) }], total)
      setResult((r) => ({ added: (r?.added ?? 0) + total.added, duplicates: (r?.duplicates ?? 0) + total.duplicates, rejected: [...(r?.rejected ?? []), ...total.rejected] }))
      setPending((cur) => cur.filter((x) => x !== p))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Section title="Images et vidéos">
      <p className="lead">
        Une image ou une vidéo par exemple, ou des dossiers entiers (plusieurs milliers possibles : le traitement se fait un
        fichier après l'autre). Les épaules doivent être visibles, pas seulement la main.
      </p>
      <fieldset className="mode-list">
        <legend>Comment connaître le signe de chaque fichier ?</legend>
        <label className={mode === 'folder' ? 'mode is-on' : 'mode'}><input type="radio" checked={mode === 'folder'} onChange={() => setMode('folder')} /><span><strong>Nom du dossier</strong><small>Un dossier par signe : BONJOUR/clip1.mp4. Utilisez « Choisir un dossier ».</small></span></label>
        <label className={mode === 'filename' ? 'mode is-on' : 'mode'}><input type="radio" checked={mode === 'filename'} onChange={() => setMode('filename')} /><span><strong>Début du nom de fichier</strong><small>BONJOUR_03.mp4 devient BONJOUR.</small></span></label>
        <label className={mode === 'fixed' ? 'mode is-on' : 'mode'}><input type="radio" checked={mode === 'fixed'} onChange={() => setMode('fixed')} /><span><strong>Le même signe pour tous</strong><small>Tous les fichiers choisis sont des exemples du même signe.</small></span></label>
      </fieldset>
      {mode === 'fixed' && <label className="field"><span>Signe</span><input value={fixed} onChange={(e) => setFixed(e.target.value)} /></label>}

      <h3>Contexte de capture</h3>
      <p className="hintline">Facultatif mais précieux : la diversité des conditions évite que le modèle apprenne une caméra ou une pièce plutôt qu'un signe.</p>
      <div className="params">
        <label className="field"><span>Langue des signes</span><input value={meta.language} placeholder="LSF, ASL…" onChange={(e) => setMeta({ ...meta, language: e.target.value })} /></label>
        <label className="field"><span>Personne</span><input value={meta.signer} placeholder="pseudo" onChange={(e) => setMeta({ ...meta, signer: e.target.value })} /></label>
        <label className="field"><span>Variante</span><input value={meta.variant} onChange={(e) => setMeta({ ...meta, variant: e.target.value })} /></label>
        <label className="field"><span>Caméra</span><input value={meta.camera} placeholder="téléphone, webcam…" onChange={(e) => setMeta({ ...meta, camera: e.target.value })} /></label>
        <label className="field"><span>Éclairage</span><input value={meta.lighting} placeholder="jour, intérieur, faible" onChange={(e) => setMeta({ ...meta, lighting: e.target.value })} /></label>
        <label className="field"><span>Arrière-plan</span><input value={meta.background} placeholder="mur uni, bureau…" onChange={(e) => setMeta({ ...meta, background: e.target.value })} /></label>
        <label className="field"><span>Distance</span><input value={meta.distance} placeholder="1 m, 2 m…" onChange={(e) => setMeta({ ...meta, distance: e.target.value })} /></label>
        <label className="field"><span>Cadence des vidéos</span>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            <option value={30}>30 images/s (recommandé)</option><option value={15}>15 images/s (2× plus rapide)</option>
          </select></label>
      </div>
      <label className="check-line"><input type="checkbox" checked={autoSegment} onChange={(e) => setAutoSegment(e.target.checked)} /> Repérer automatiquement les signes dans les vidéos longues, pour que je vérifie le découpage</label>

      <div className="inline-form">
        <label className="field"><span>Fichiers</span>
          <input type="file" accept="image/*,video/*" multiple disabled={busy || !datasetId} onChange={(e) => void run(e.target.files)} /></label>
        <label className="field"><span>Choisir un dossier</span>
          <input type="file" multiple disabled={busy || !datasetId} {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => void run(e.target.files)} /></label>
      </div>

      {progress && (
        <div className="note" role="status">
          {progress.label} — fichier {Math.min(progress.done + 1, progress.total)} sur {progress.total}
          <button className="btn btn-link" onClick={() => (cancelled.current = true)}>Annuler</button>
        </div>
      )}
      <ErrorNote message={error} />
      {result && <Summary r={result} />}

      {pending.map((p) => (
        <SegmentEditor key={p.file} p={p} fps={fps} onChange={(next) => setPending((cur) => cur.map((x) => (x === p ? next : x)))} onConfirm={() => void confirm(p)} onSkip={() => setPending((cur) => cur.filter((x) => x !== p))} />
      ))}
    </Section>
  )
}

/** Ligne de temps d'une vidéo : mains détectées (barres) et segments proposés, corrigeables à la main. */
function SegmentEditor({ p, fps, onChange, onConfirm, onSkip }: { p: Pending; fps: number; onChange: (p: Pending) => void; onConfirm: () => void; onSkip: () => void }) {
  const n = p.extracted.nFrames
  const set = (i: number, patch: Partial<Pending['segments'][number]>) =>
    onChange({ ...p, segments: p.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  return (
    <div className="segment-editor">
      <h3>Découpage de {p.file}</h3>
      <p className="hintline">La détection propose {p.segments.length} signe(s). Barres grises : images où une main est visible ; zones encadrées : segments retenus. Corrigez les bornes (en images, {fps} images = 1 s) et donnez un signe à chaque segment.</p>
      <svg viewBox={`0 0 ${n} 30`} preserveAspectRatio="none" className="timeline" role="img" aria-label="Ligne de temps de la vidéo">
        {p.extracted.active.map((a, i) => (a ? <rect key={i} x={i} y={14} width={1} height={14} fill="var(--ink-2)" /> : null))}
        {p.segments.map((s, i) => (
          <g key={i}>
            <rect x={s.start} y={1} width={Math.max(s.end - s.start, 0.5)} height={28} fill="none" stroke="var(--ink)" strokeWidth={n / 300} vectorEffect="non-scaling-stroke" />
            <text x={s.start + 1} y={11} fontSize={Math.max(n / 40, 8)} fill="var(--ink)">{i + 1}</text>
          </g>
        ))}
      </svg>
      <ul className="plain">
        {p.segments.map((s, i) => (
          <li key={i} className="seg-row">
            <span>Segment {i + 1}</span>
            <label>début <input type="number" min={0} max={n} value={s.start} onChange={(e) => set(i, { start: Number(e.target.value) })} /></label>
            <label>fin <input type="number" min={0} max={n} value={s.end} onChange={(e) => set(i, { end: Number(e.target.value) })} /></label>
            <label>signe <input value={s.label} onChange={(e) => set(i, { label: e.target.value })} /></label>
            <button className="btn btn-link" onClick={() => onChange({ ...p, segments: p.segments.filter((_, k) => k !== i) })}>Retirer</button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="btn btn-quiet" onClick={() => onChange({ ...p, segments: [...p.segments, { start: 0, end: Math.min(n, fps), label: p.label }] })}>Ajouter un segment</button>
        <button className="btn btn-primary" disabled={!p.segments.some((s) => s.end > s.start && s.label.trim())} onClick={onConfirm}>Importer ces segments</button>
        <button className="btn btn-quiet" onClick={onSkip}>Ignorer cette vidéo</button>
      </div>
    </div>
  )
}
