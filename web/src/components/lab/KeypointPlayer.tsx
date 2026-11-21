import { useEffect, useRef, useState } from 'react'
import { lab } from '../../lib/lab'

/** Liaisons des 21 points d'une main (MediaPipe) : poignet, cinq doigts, paume. */
const HAND_LINES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]
/** Points de pose retenus : nez, épaules G/D, coudes G/D, poignets G/D. */
const POSE_LINES: [number, number][] = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6]]

const SIZE = 260
const SCALE = 38 // pixels par largeur d'épaules
const ORIGIN = { x: SIZE / 2, y: 78 }

type Frame = number[]

/**
 * Rejoue un exemple à partir de ses points : on ne conserve jamais la vidéo, donc c'est la seule façon de
 * « voir » un exemple avant de le valider. Affichage en miroir, comme l'aperçu de la caméra.
 */
export function KeypointPlayer({ sampleId }: { sampleId: string }) {
  const [frames, setFrames] = useState<Frame[] | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(true)
  const [index, setIndex] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let alive = true
    lab.window(sampleId).then(
      (w) => alive && setFrames(w.frames),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [sampleId])

  useEffect(() => {
    if (!playing || !frames || frames.length < 2) return
    const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), 90)
    return () => clearInterval(id)
  }, [playing, frames])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !frames) return
    const css = getComputedStyle(canvas.current!)
    const ink = css.getPropertyValue('--ink').trim() || '#000'
    const soft = css.getPropertyValue('--ink-2').trim() || '#666'
    const f = frames[Math.min(index, frames.length - 1)]
    ctx.clearRect(0, 0, SIZE, SIZE)

    const pt = (base: number, i: number): [number, number] | null => {
      const x = f[base + i * 3]
      const y = f[base + i * 3 + 1]
      if (x === 0 && y === 0) return null // point non détecté
      return [ORIGIN.x - x * SCALE, ORIGIN.y + y * SCALE] // x inversé : aperçu en miroir
    }
    const line = (a: [number, number] | null, b: [number, number] | null, color: string, w: number) => {
      if (!a || !b) return
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(...a)
      ctx.lineTo(...b)
      ctx.stroke()
    }
    const dot = (p: [number, number] | null, r: number, color: string) => {
      if (!p) return
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const [a, b] of POSE_LINES) line(pt(126, a), pt(126, b), soft, 2)
    for (let i = 0; i < 7; i++) dot(pt(126, i), 3.5, soft)
    for (const base of [0, 63]) {
      for (const [a, b] of HAND_LINES) line(pt(base, a), pt(base, b), ink, 1.5)
      for (let i = 0; i < 21; i++) dot(pt(base, i), 2.4, ink)
    }
  }, [frames, index])

  if (error) return <p className="error">{error}</p>
  if (!frames) return <p className="muted">Chargement de l'exemple…</p>
  return (
    <div className="player">
      <canvas ref={canvas} width={SIZE} height={SIZE} role="img" aria-label="Rejeu des points d'un exemple : mains, bras et épaules" />
      <div className="player-controls">
        <button className="btn btn-quiet" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Lecture'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={Math.min(index, frames.length - 1)}
          aria-label="Position dans l'exemple"
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
        />
      </div>
    </div>
  )
}
