import { describe, expect, it } from 'vitest'
import { VALUES_PER_FRAME, emptyFrame } from './landmarks'
import { FRAMES_PER_PACKET, encodePacket, streamUrl } from './stream'

describe('encodePacket', () => {
  it('produit l\'en-tête et la taille attendus par le serveur', () => {
    const frames = Array.from({ length: FRAMES_PER_PACKET }, (_, i) => emptyFrame(i))
    const buf = encodePacket(258, frames)
    // 6 octets d'en-tête + 10 × (1 + 273 × 2) — même constante que api/tests/test_protocol.py
    expect(buf.byteLength).toBe(6 + 10 * 547)
    const view = new DataView(buf)
    expect(view.getUint8(0)).toBe(1) // version
    expect(view.getUint8(1)).toBe(10) // nombre d'images
    expect(view.getUint32(2, true)).toBe(258) // séquence, petit-boutiste
  })

  it('encode les drapeaux et les valeurs quantifiées', () => {
    const f = emptyFrame(0)
    f.valid = true
    f.rightHand = true
    f.data[0] = 1.5
    f.data[VALUES_PER_FRAME - 1] = -2
    const view = new DataView(encodePacket(0, [f]))
    expect(view.getUint8(6)).toBe(1 | 4)
    expect(view.getInt16(7, true)).toBe(6144) // 1,5 × 4096
    expect(view.getInt16(7 + (VALUES_PER_FRAME - 1) * 2, true)).toBe(-8192)
  })
})

describe('streamUrl', () => {
  it('suit le protocole de la page', () => {
    expect(streamUrl({ protocol: 'https:', host: 'sikia.app' })).toBe('wss://sikia.app/v1/stream')
    expect(streamUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/v1/stream')
  })
})
