import { describe, expect, it } from 'vitest'
import { assessFraming, createHintSmoother } from './quality'
import type { Point, RawFrame } from './landmarks'

const p = (x: number, y: number): Point => ({ x, y, z: 0 })
const hand = (x = 0.5, y = 0.5): Point[] => Array.from({ length: 21 }, () => p(x, y))
const frame = (over: Partial<RawFrame> = {}): RawFrame => ({
  aspect: 1.33,
  leftHand: hand(),
  rightHand: hand(),
  pose: [p(0.5, 0.5)],
  face: [p(0.5, 0.2)],
  ...over,
})

describe('assessFraming', () => {
  it('signale le problème le plus grave en premier', () => {
    expect(assessFraming(frame({ pose: null }), 10)).toBe('light')
    expect(assessFraming(frame({ pose: null }), 200)).toBe('body')
    expect(assessFraming(frame({ leftHand: null }), 200)).toBe('hands')
    expect(assessFraming(frame({ rightHand: hand(0.99, 0.5) }), 200)).toBe('edge')
    expect(assessFraming(frame(), 200)).toBe('ok')
  })
})

describe('createHintSmoother', () => {
  it("n'affiche un nouvel état qu'après plusieurs détections identiques", () => {
    const smooth = createHintSmoother(3, 'body')
    expect(smooth('ok')).toBe('body')
    expect(smooth('ok')).toBe('body')
    expect(smooth('ok')).toBe('ok')
  })

  it('ignore un état éphémère', () => {
    const smooth = createHintSmoother(3, 'ok')
    smooth('hands')
    smooth('hands')
    expect(smooth('ok')).toBe('ok') // retour à la normale : le compteur repart de zéro
    expect(smooth('hands')).toBe('ok')
  })
})
