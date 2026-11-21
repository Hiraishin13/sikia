/** Client de l'API du laboratoire (/v1/lab/*). Le jeton n'est gardé que pour la durée de l'onglet. */

const TOKEN_KEY = 'sikia.lab.token'

export const labToken = {
  get(): string {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  },
  set(value: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, value)
    } catch {
      /* stockage bloqué : le jeton sera redemandé */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* sans importance */
    }
  },
}

export class LabError extends Error {
  status: number
  /** Corps de l'erreur : porte par exemple le détail de la barrière de promotion. */
  detail?: unknown

  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export interface Dataset {
  id: string
  name: string
  description: string
  sign_language: string
  kind: string
  synthetic: boolean
  created_at: number
  n_samples?: number
  n_validated?: number
  n_to_review?: number
}

export interface Sample {
  id: string
  dataset_id: string
  label: string
  language: string
  signer: string
  variant: string
  media: string
  status: 'validated' | 'pending' | 'unlabeled' | 'rejected'
  split: 'train' | 'val' | 'test' | null
  quality: number | null
  issues: string[]
  static: boolean
  n_frames: number
  duration_s: number
  meta: Record<string, unknown>
  predicted_label?: string | null
  predicted_conf?: number | null
}

export interface SignStats {
  count: number
  signers: number
  languages: string[]
  variants: string[]
  mean_quality: number
  splits: Record<string, number>
}

export interface Stats {
  samples: number
  datasets: number
  images: number
  videos: number
  signs: number
  signers: number
  static_samples: number
  by_media: Record<string, number>
  by_status: Record<string, number>
  by_split: Record<string, number>
  by_language: Record<string, number>
  by_dataset: Record<string, number>
  per_sign: Record<string, SignStats>
  imbalance: {
    max: number
    min: number
    ratio: number
    underrepresented: string[]
    few_signers: string[]
    recommended: { examples_per_sign: number; signers_per_sign: number }
  }
  missing: { no_signer: number; no_language: number; no_label: number }
  quality: { mean: number; low: number; issues: Record<string, number> }
  diversity: { metadata_coverage: Record<string, number> }
}

export interface RunEvent {
  type: string
  t: number
  epoch?: number
  epochs?: number
  loss?: number
  val_loss?: number
  val_accuracy?: number
  val_macro_f1?: number
  frozen?: boolean
  train?: number
  val?: number
  test?: number
  n?: number
  new?: string[]
  replayed?: number
  version?: string
  test_accuracy?: number
  warnings?: string[]
  message?: string
  status?: string
  device?: string
}

export interface Run {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  params: Record<string, unknown>
  model_id: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  events?: RunEvent[]
  next?: number
  log_tail?: string
}

export interface ClassMetrics {
  precision: number
  recall: number
  f1: number
  support: number
}

export interface Evaluation {
  n: number
  accuracy: number
  error_rate?: number
  top3_accuracy?: number
  macro?: { precision: number; recall: number; f1: number }
  weighted?: { precision: number; recall: number; f1: number }
  mean_confidence?: number
  mean_confidence_correct?: number
  mean_confidence_wrong?: number
  per_class?: Record<string, ClassMetrics>
  confusion?: number[][]
  labels?: string[]
  by_language?: Record<string, { accuracy: number; n: number }>
  by_dataset?: Record<string, { accuracy: number; n: number }>
  by_signer?: Record<string, { accuracy: number; n: number }>
  hardest_signs?: (ClassMetrics & { label: string })[]
  top_confusions?: { true: string; predicted: string; count: number }[]
  abstention?: { threshold: number; precision: number; coverage: number; abstained: number }
  unknown_label_samples?: number
}

export interface ModelCard {
  id: string
  version: string
  name?: string
  notes?: string
  status: 'candidate' | 'active' | 'archived' | 'rejected'
  mode: string
  created_at: number
  dataset_ids: string[]
  n_train: number
  duration_s: number
  params: Record<string, unknown>
  accuracy: number | null
  macro_f1: number | null
  n_test: number | null
  mean_confidence: number | null
  hardest_signs: (ClassMetrics & { label: string })[]
  top_confusions: { true: string; predicted: string; count: number }[]
}

export interface ModelFull extends ModelCard {
  metrics: {
    signer_independent: boolean
    split: { signers: Record<string, string[]>; anonymous_samples: number }
    val: Evaluation
    test: Evaluation
    calibration: { threshold: number; precision: number; coverage: number; reached: boolean }
    threshold: number
    history: RunEvent[]
    warnings: string[]
    train: { n: number; replayed: number; classes: number; per_class: Record<string, number> }
  }
}

export interface GateCheck {
  name: string
  ok: boolean
  detail: string
}
export interface Gate {
  ok: boolean
  checks: GateCheck[]
  summary: Record<string, unknown>
}

export interface Comparison {
  a: ModelCard
  b: ModelCard
  same_test_set: boolean
  gate: Gate
  per_class: {
    accuracy_delta: number
    macro_f1_delta: number
    improved: { label: string; f1_old: number; f1_new: number; delta: number }[]
    regressed: { label: string; f1_old: number; f1_new: number; delta: number }[]
  } | null
}

export interface Hypothesis {
  label: string
  confidence: number
}
export interface ActiveItem {
  sample: Sample
  uncertainty: number
  margin: number
  hypotheses: Hypothesis[]
}

export interface Overview {
  active_model: ModelCard | null
  datasets: Dataset[]
  to_review: number
  runs: Run[]
  models: number
  sign_languages: string[]
}

export interface SampleQuery {
  dataset_ids?: string[]
  label?: string
  language?: string
  signer?: string
  status?: string
  split?: string
  media?: string
  search?: string
  issue?: string
  max_quality?: number
  order?: string
  limit?: number
  offset?: number
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/v1/lab${path}`, {
      method,
      headers: { Authorization: `Bearer ${labToken.get()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new LabError('Serveur injoignable.', 0)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail
    const message =
      typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : `Erreur ${res.status}`
    throw new LabError(message, res.status, detail)
  }
  return data as T
}

const qs = (params: Record<string, unknown>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)
  return entries.length
    ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])).toString()
    : ''
}

export const lab = {
  overview: () => call<Overview>('GET', '/overview'),
  datasets: () => call<Dataset[]>('GET', '/datasets'),
  createDataset: (d: { name: string; description?: string; sign_language?: string }) => call<Dataset>('POST', '/datasets', d),
  deleteDataset: (id: string) => call<{ deleted_samples: number }>('DELETE', `/datasets/${id}`),
  stats: (ids?: string[]) => call<Stats>('GET', `/stats${qs({ dataset_ids: ids })}`),
  samples: (q: SampleQuery) => call<{ items: Sample[]; total: number }>('GET', `/samples${qs({ ...q })}`),
  patchSample: (id: string, patch: Partial<Pick<Sample, 'label' | 'language' | 'signer' | 'variant' | 'status' | 'split'>>) =>
    call<Sample>('PATCH', `/samples/${id}`, patch),
  deleteSample: (id: string) => call<void>('DELETE', `/samples/${id}`),
  window: (id: string, maxFrames = 48) =>
    call<{ n_frames: number; step: number; layout: Record<string, [number, number]>; frames: number[][] }>(
      'GET',
      `/samples/${id}/window${qs({ max_frames: maxFrames })}`,
    ),
  duplicates: (ids?: string[]) =>
    call<{ label: string; a: string; b: string; distance: number }[]>('GET', `/duplicates${qs({ dataset_ids: ids })}`),
  assignSplits: (ids: string[]) =>
    call<{ samples: number; by_split: Record<string, number>; signer_independent: boolean; anonymous_samples: number }>(
      'POST',
      '/splits',
      { dataset_ids: ids },
    ),
  importRecordings: (
    datasetId: string,
    body: { recordings: unknown[]; language?: string; signer?: string; variant?: string; media?: string; status?: string },
  ) =>
    call<{ added: string[]; duplicates: { source: string }[]; rejected: { source: string; reason: string }[] }>(
      'POST',
      `/datasets/${datasetId}/import/recordings`,
      body,
    ),
  importMetadata: (datasetId: string, csv: string) =>
    call<{ updated: number; not_found: string[] }>('POST', `/datasets/${datasetId}/import/metadata`, { csv }),
  segment: (recording: unknown) =>
    call<{ n_frames: number; segments: { start: number; end: number; quality: number }[] }>('POST', '/segment', { recording }),
  review: () => call<{ pending: Sample[]; unlabeled: Sample[]; total_pending: number; total_unlabeled: number }>('GET', '/review'),
  validate: (id: string, d: { label?: string; language?: string; variant?: string }) =>
    call<Sample>('POST', `/samples/${id}/validate`, d),
  rejectSample: (id: string) => call<Sample>('POST', `/samples/${id}/reject`),
  activeLearning: (n = 30, strategy = 'margin', ids?: string[]) =>
    call<{ model: string; items: ActiveItem[] }>('GET', `/active-learning${qs({ n, strategy, dataset_ids: ids })}`),
  startTraining: (params: Record<string, unknown>) => call<Run>('POST', '/training', params),
  runs: () => call<Run[]>('GET', '/runs'),
  run: (id: string, since = 0) => call<Run>('GET', `/runs/${id}${qs({ since })}`),
  cancelRun: (id: string) => call<Run>('POST', `/runs/${id}/cancel`),
  models: () => call<ModelCard[]>('GET', '/models'),
  model: (id: string) => call<ModelFull>('GET', `/models/${id}`),
  compare: (a: string, b: string) => call<Comparison>('GET', `/compare${qs({ a, b })}`),
  gate: (id: string) => call<Gate>('GET', `/models/${id}/gate`),
  activate: (id: string, force = false, reason = '') => call<{ model: ModelCard; gate: Gate }>('POST', `/models/${id}/activate`, { force, reason }),
  rollback: () => call<{ model: ModelCard }>('POST', '/models/rollback'),
  rejectModel: (id: string) => call<ModelCard>('POST', `/models/${id}/reject`),
  evaluate: (id: string, datasetIds: string[]) => call<ModelCard>('POST', `/models/${id}/evaluate`, { dataset_ids: datasetIds }),
  history: () => call<{ model_id: string; version: string; at: number; forced: number; reason: string }[]>('GET', '/history'),
}

/** Formats d'affichage. */
export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits).replace('.', ',')} %`

export const duration = (s: number | null | undefined): string => {
  if (!s && s !== 0) return '—'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1).replace('.', ',')} h`
}

export const dateFr = (t: number | null | undefined): string =>
  t ? new Date(t * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export const MODE_LABEL: Record<string, string> = {
  initial: 'Entraînement initial',
  finetune: 'Fine-tuning',
  incremental: 'Incrémental',
  transfer: 'Transfert',
}
export const STATUS_LABEL: Record<string, string> = {
  validated: 'Validé',
  pending: 'À valider',
  unlabeled: 'Sans label',
  rejected: 'Rejeté',
  queued: 'En attente',
  running: 'En cours',
  done: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
  candidate: 'Candidat',
  active: 'En service',
  archived: 'Archivé',
}
