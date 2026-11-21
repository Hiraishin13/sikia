import { VALUES_PER_FRAME, quantize16, type KeypointFrame } from './landmarks'

/** Protocole de /v1/stream : voir api/app/protocol.py. */
const PROTOCOL_VERSION = 1
export const FRAMES_PER_PACKET = 10 // ≈ 330 ms à 30 i/s
const FRAME_BYTES = 1 + VALUES_PER_FRAME * 2
const HEADER_BYTES = 6

export function encodePacket(seq: number, frames: KeypointFrame[]): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + frames.length * FRAME_BYTES)
  const view = new DataView(buf)
  view.setUint8(0, PROTOCOL_VERSION)
  view.setUint8(1, frames.length)
  view.setUint32(2, seq >>> 0, true)

  let offset = HEADER_BYTES
  for (const f of frames) {
    const flags = (f.valid ? 1 : 0) | (f.leftHand ? 2 : 0) | (f.rightHand ? 4 : 0) | (f.face ? 8 : 0)
    view.setUint8(offset, flags)
    const q = quantize16(f.data)
    for (let i = 0; i < VALUES_PER_FRAME; i++) view.setInt16(offset + 1 + i * 2, q[i], true)
    offset += FRAME_BYTES
  }
  return buf
}

export interface GlossAlt {
  gloss: string
  confidence: number
}
export interface Gloss extends GlossAlt {
  alternatives: GlossAlt[]
}

export type ServerMessage =
  | { type: 'ready'; version: number }
  | { type: 'partial'; seq: number; glosses: Gloss[] }
  | {
      type: 'final'
      seq: number
      sentence_id: string
      glosses: Gloss[]
      /** null en mode dégradé : on affiche alors les gloses brutes. */
      text: string | null
      uncertain: boolean
      degraded: boolean
    }
  | { type: 'error'; code: string; message: string }

/** Une phrase finale renvoyée par le serveur. */
export type Sentence = Extract<ServerMessage, { type: 'final' }>

export type ConnectionState = 'connecting' | 'open' | 'closed'

export interface StreamHandlers {
  onMessage(msg: ServerMessage): void
  onState(state: ConnectionState): void
}

export function streamUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/v1/stream`
}

/** Envoie les images par paquets de FRAMES_PER_PACKET et relaie les réponses du serveur. */
export class StreamClient {
  private ws: WebSocket
  private pending: KeypointFrame[] = []
  private seq = 0

  constructor(handlers: StreamHandlers, url = streamUrl()) {
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    handlers.onState('connecting')
    this.ws.onopen = () => handlers.onState('open')
    this.ws.onclose = () => handlers.onState('closed')
    this.ws.onerror = () => handlers.onState('closed')
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return
      try {
        handlers.onMessage(JSON.parse(e.data) as ServerMessage)
      } catch {
        /* message illisible : ignoré */
      }
    }
  }

  push(frame: KeypointFrame): void {
    this.pending.push(frame)
    if (this.pending.length >= FRAMES_PER_PACKET) this.flush()
  }

  private flush(): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      // Hors ligne ou connexion en cours : on jette plutôt que d'accumuler du retard.
      this.pending = []
      return
    }
    this.ws.send(encodePacket(this.seq++, this.pending))
    this.pending = []
  }

  reset(): void {
    this.pending = []
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'reset' }))
  }

  close(): void {
    this.ws.onclose = null
    this.ws.close()
  }
}
