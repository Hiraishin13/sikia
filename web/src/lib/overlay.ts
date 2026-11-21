import { FACE_INDICES, POSE_INDICES, type Point, type RawFrame } from './landmarks'

function dots(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  indices: readonly number[] | null,
  radius: number,
  alpha: number,
) {
  ctx.fillStyle = `rgb(243 241 234 / ${alpha})`
  const list = indices ? indices.map((i) => pts[i]) : pts
  for (const p of list) {
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Dessine les points détectés par-dessus la vidéo. Un seul ton, l'importance passe par
 * l'opacité : les mains (ce qui compte) ressortent, le corps et le visage restent discrets.
 */
export function drawOverlay(canvas: HTMLCanvasElement, raw: RawFrame | null): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!raw) return
  if (raw.pose) dots(ctx, raw.pose, POSE_INDICES, 4, 0.5)
  if (raw.face) dots(ctx, raw.face, FACE_INDICES, 1.8, 0.45)
  if (raw.leftHand) dots(ctx, raw.leftHand, null, 3.5, 0.95)
  if (raw.rightHand) dots(ctx, raw.rightHand, null, 3.5, 0.95)
}
