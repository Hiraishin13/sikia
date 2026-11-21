import { normalizeFrame, type KeypointFrame } from './landmarks'
import { serialize } from './recording'
import type { Tracker } from './tracker'

/**
 * Extraction des points clés depuis des images et des vidéos, DANS LE NAVIGATEUR : le média n'est jamais
 * envoyé, seuls les points le sont. Le résultat est un « enregistrement » au même format que la caméra.
 */

export type LabelMode = 'fixed' | 'folder' | 'filename'

export interface FileLike {
  name: string
  type: string
  webkitRelativePath?: string
}

export const isImage = (f: FileLike) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
export const isVideo = (f: FileLike) => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv|avi)$/i.test(f.name)

/** Déduit le signe d'un fichier : texte fixe, nom du dossier parent, ou début du nom (« BONJOUR_03.mp4 » → BONJOUR). */
export function deriveLabel(file: FileLike, mode: LabelMode, fixed: string): string {
  if (mode === 'fixed') return fixed.trim()
  if (mode === 'folder') {
    const parts = (file.webkitRelativePath ?? '').split('/').filter(Boolean)
    return parts.length >= 2 ? parts[parts.length - 2].trim() : ''
  }
  const base = file.name.replace(/\.[^.]+$/, '')
  const cut = base.split(/[_\-\s]/)[0] || base
  return cut.replace(/\d+$/, '').trim() || cut
}

/** Compteur d'horodatages : MediaPipe exige des valeurs strictement croissantes pour un même suivi. */
export class Clock {
  private t = 0
  next(): number {
    this.t += 34
    return this.t
  }
}

export interface Extracted {
  /** Enregistrement prêt à envoyer (format de recording.ts + media, fps, source_name). */
  doc: Record<string, unknown>
  nFrames: number
  /** Pour chaque image : au moins une main détectée, épaules visibles. Sert à tracer la ligne de temps. */
  active: boolean[]
  warning?: string
}

const hasHand = (f: KeypointFrame) => f.valid && (f.leftHand || f.rightHand)

function toDoc(frames: KeypointFrame[], file: FileLike, media: 'image' | 'video', fps: number, extra: Record<string, unknown>) {
  const doc = serialize({ id: 'x', label: '', createdAt: new Date().toISOString(), frames }) as Record<string, unknown>
  return { ...doc, media, fps, source_name: file.name, ...extra }
}

export async function extractImage(file: File, tracker: Tracker, clock: Clock, extra: Record<string, unknown> = {}): Promise<Extracted> {
  const bitmap = await createImageBitmap(file)
  try {
    const { raw } = tracker.detect(bitmap, clock.next())
    const frame = normalizeFrame(raw, 0)
    const ok = hasHand(frame)
    return {
      doc: toDoc([frame], file, 'image', 1, extra),
      nFrames: 1,
      active: [ok],
      warning: !frame.valid
        ? 'épaules introuvables : cadrez la tête et les épaules, pas seulement la main'
        : !ok
          ? 'aucune main détectée'
          : undefined,
    }
  } finally {
    bitmap.close()
  }
}

function once(target: HTMLVideoElement, event: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai dépassé (${event})`)), timeoutMs)
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
    target.addEventListener('error', () => reject(new Error('vidéo illisible par ce navigateur')), { once: true })
  })
}

export interface VideoOptions {
  fps: number
  maxSeconds: number
  onProgress?: (done: number, total: number) => void
  isCancelled?: () => boolean
}

/** Lit la vidéo image par image à `fps` images/s et en extrait les points clés. */
export async function extractVideo(file: File, tracker: Tracker, clock: Clock, opts: VideoOptions, extra: Record<string, unknown> = {}): Promise<Extracted> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = url
    await once(video, 'loadeddata')
    if (!video.videoWidth) throw new Error('vidéo illisible par ce navigateur')
    const duration = Math.min(video.duration || 0, opts.maxSeconds)
    const total = Math.max(1, Math.floor(duration * opts.fps))
    const frames: KeypointFrame[] = []
    for (let i = 0; i < total; i++) {
      if (opts.isCancelled?.()) throw new Error('annulé')
      video.currentTime = Math.min(i / opts.fps, Math.max(duration - 0.001, 0))
      await once(video, 'seeked')
      const { raw } = tracker.detect(video, clock.next())
      frames.push(normalizeFrame(raw, (i * 1000) / opts.fps))
      opts.onProgress?.(i + 1, total)
    }
    const active = frames.map(hasHand)
    const n = active.filter(Boolean).length
    return {
      doc: toDoc(frames, file, 'video', opts.fps, extra),
      nFrames: frames.length,
      active,
      warning: n === 0 ? 'aucune main détectée avec les épaules visibles' : n < 8 ? `seulement ${n} images avec une main` : undefined,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
