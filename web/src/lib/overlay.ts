import { FACE_INDICES, POSE_INDICES, type Point, type RawFrame } from './landmarks'

function dots(ctx: CanvasRenderingContext2D, pts: Point[], indices: readonly number[] | null, r: number, color: string) {
  ctx.fillStyle = color
  const list = indices ? indices.map((i) => pts[i]) : pts
  for (const p of list) {
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Dessine les points détectés par-dessus la vidéo (le canvas a la taille de la vidéo). */
export function drawOverlay(canvas: HTMLCanvasElement, raw: RawFrame | null): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!raw) return
  if (raw.pose) dots(ctx, raw.pose, POSE_INDICES, 5, '#f5b83d')
  if (raw.face) dots(ctx, raw.face, FACE_INDICES, 2, '#7dd3fc')
  if (raw.leftHand) dots(ctx, raw.leftHand, null, 3.5, '#4ade80')
  if (raw.rightHand) dots(ctx, raw.rightHand, null, 3.5, '#f472b6')
}
