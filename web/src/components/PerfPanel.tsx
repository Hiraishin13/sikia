import { useState } from 'react'
import type { PerfSnapshot } from '../hooks/useCapture'
import { TARGET_FPS, formatReport, meetsTarget, slowestStage } from '../lib/perf'
import { Icon } from './Icon'

const STAGE_NAME = { hands: 'mains', pose: 'pose', face: 'visage' } as const

function deviceInfo(video: string) {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    video,
  }
}

/** Diagnostic de performance (affiché avec ?debug) : à ouvrir sur le téléphone cible, puis copier le rapport. */
export function PerfPanel({ perf }: { perf: PerfSnapshot | null }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  if (!perf) {
    return (
      <section className="perf" aria-label="Performances">
        <h2>Performances</h2>
        <p className="hintline">Mesure en cours… placez-vous devant la caméra quelques secondes.</p>
      </section>
    )
  }

  const { stats, delegates, faceStride } = perf
  const ok = meetsTarget(stats)
  const slow = slowestStage(stats)
  const ms = (n: number) => `${n.toFixed(0)} ms`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatReport(stats, delegates, deviceInfo(perf.video), faceStride))
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  return (
    <section className="perf" aria-label="Performances">
      <h2>Performances</h2>
      <p className={`framing ${ok ? 'framing-ok' : 'framing-warn'}`} role="status">
        <Icon name={ok ? 'check' : 'alert'} />
        {stats.fps.toFixed(1)} i/s · cible {TARGET_FPS} i/s {ok ? 'atteinte' : 'non atteinte'}
      </p>

      <dl className="perf-grid">
        <dt>Par image</dt>
        <dd>
          médiane {ms(stats.medianMs)} · pire 5 % {ms(stats.p95Ms)}
        </dd>
        <dt>Étapes</dt>
        <dd>
          mains {ms(stats.stages.hands)} · pose {ms(stats.stages.pose)} · visage {ms(stats.stages.face)}
          {faceStride > 1 ? ` (1 image sur ${faceStride})` : ''}
        </dd>
        <dt>Calcul</dt>
        <dd>
          mains {delegates.hands} · pose {delegates.pose} · visage {delegates.face}
        </dd>
        <dt>Vidéo</dt>
        <dd>{perf.video}</dd>
      </dl>

      {!ok && (
        <p className="hintline">
          Étape la plus lente : <strong>{STAGE_NAME[slow]}</strong>
          {delegates[slow] === 'CPU' ? ' (calcul sur le processeur : le GPU n’est pas disponible ici).' : '.'}
          {slow === 'face' && faceStride < 3 ? ' Essayez ?debug&facestride=3.' : ''}
        </p>
      )}

      <button className="btn btn-quiet" onClick={copy}>
        Copier le rapport
      </button>
      {copied === 'yes' && <p className="note note-ok">Rapport copié.</p>}
      {copied === 'no' && <p className="note">Copie impossible : sélectionnez le texte ci-dessus.</p>}
    </section>
  )
}
