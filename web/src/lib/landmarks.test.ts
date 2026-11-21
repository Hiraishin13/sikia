import { describe, expect, it } from 'vitest'
import {
  FACE_INDICES,
  HAND_POINTS,
  LAYOUT,
  VALUES_PER_FRAME,
  dequantize16,
  emptyFrame,
  fillShortGaps,
  normalizeFrame,
  quantize16,
  type Point,
  type RawFrame,
} from './landmarks'

const pt = (x: number, y: number, z = 0, visibility = 1): Point => ({ x, y, z, visibility })

/** Pose factice : épaules en (0.4, 0.5) et (0.6, 0.5), tout le reste à l'origine. */
function fakePose(): Point[] {
  const pose = Array.from({ length: 33 }, () => pt(0, 0))
  pose[11] = pt(0.4, 0.5)
  pose[12] = pt(0.6, 0.5)
  return pose
}

function fakeHand(x: number, y: number): Point[] {
  return Array.from({ length: HAND_POINTS }, () => pt(x, y))
}

function raw(partial: Partial<RawFrame> = {}): RawFrame {
  return { aspect: 1, leftHand: null, rightHand: null, pose: fakePose(), face: null, ...partial }
}

describe('format', () => {
  it('compte 273 valeurs par image', () => {
    expect(FACE_INDICES.length).toBe(42)
    expect(VALUES_PER_FRAME).toBe(21 * 3 * 2 + 7 * 3 + 42 * 3)
  })
})

describe('normalizeFrame', () => {
  it('recentre sur le milieu des épaules et divise par leur largeur', () => {
    const f = normalizeFrame(raw({ leftHand: fakeHand(0.5 + 0.2, 0.5) }), 0)
    expect(f.valid).toBe(true)
    expect(f.leftHand).toBe(true)
    // largeur d'épaules = 0.2 → un décalage de 0.2 vaut 1 largeur
    expect(f.data[LAYOUT.leftHand.offset]).toBeCloseTo(1)
    expect(f.data[LAYOUT.leftHand.offset + 1]).toBeCloseTo(0)
  })

  it("est invariant à la distance à la caméra", () => {
    const near = normalizeFrame(raw({ leftHand: fakeHand(0.7, 0.6) }), 0)
    const farPose = fakePose().map((p) => pt(0.5 + (p.x - 0.5) / 2, 0.5 + (p.y - 0.5) / 2))
    farPose[11] = pt(0.45, 0.5)
    farPose[12] = pt(0.55, 0.5)
    const far = normalizeFrame(raw({ pose: farPose, leftHand: fakeHand(0.6, 0.55) }), 0)
    for (let i = 0; i < 3; i++) {
      expect(far.data[LAYOUT.leftHand.offset + i]).toBeCloseTo(near.data[LAYOUT.leftHand.offset + i])
    }
  })

  it('tient compte du rapport largeur/hauteur', () => {
    // vidéo 2:1 : un écart vertical de 0.1 vaut 0.05 en unités isotropes
    const f = normalizeFrame(raw({ aspect: 2, leftHand: fakeHand(0.5, 0.6) }), 0)
    // épaules : largeur 0.2 × 2 = 0.4 ; la main est 0.1 plus bas → 0.25 largeur
    expect(f.data[LAYOUT.leftHand.offset + 1]).toBeCloseTo(0.25)
  })

  it('marque invalide une image sans épaules visibles', () => {
    const pose = fakePose()
    pose[11] = pt(0.4, 0.5, 0, 0.1)
    expect(normalizeFrame(raw({ pose }), 0).valid).toBe(false)
    expect(normalizeFrame(raw({ pose: null }), 0).valid).toBe(false)
  })
})

describe('fillShortGaps', () => {
  const withHand = (t: number, x: number) => {
    const f = emptyFrame(t)
    f.valid = true
    f.rightHand = true
    f.data[LAYOUT.rightHand.offset] = x
    return f
  }
  const withoutHand = (t: number) => {
    const f = emptyFrame(t)
    f.valid = true
    return f
  }

  it('interpole un trou court', () => {
    const frames = [withHand(0, 0), withoutHand(1), withoutHand(2), withHand(3, 3)]
    fillShortGaps(frames)
    expect(frames[1].rightHand).toBe(true)
    expect(frames[1].data[LAYOUT.rightHand.offset]).toBeCloseTo(1)
    expect(frames[2].data[LAYOUT.rightHand.offset]).toBeCloseTo(2)
  })

  it('laisse un trou de 5 images ou plus', () => {
    const frames = [withHand(0, 0), ...[1, 2, 3, 4, 5].map(withoutHand), withHand(6, 6)]
    fillShortGaps(frames)
    expect(frames[3].rightHand).toBe(false)
  })

  it('ne comble pas les trous en début ou fin de séquence', () => {
    const frames = [withoutHand(0), withHand(1, 1), withoutHand(2)]
    fillShortGaps(frames)
    expect(frames[0].rightHand).toBe(false)
    expect(frames[2].rightHand).toBe(false)
  })
})

describe('quantification 16 bits', () => {
  it('conserve les valeurs à 1/4096 près', () => {
    const src = Float32Array.from([0, 1.5, -2.25, 7.99, -7.99])
    const back = dequantize16(quantize16(src))
    back.forEach((v, i) => expect(Math.abs(v - src[i])).toBeLessThan(1 / 4096))
  })

  it('sature au lieu de déborder', () => {
    const back = dequantize16(quantize16(Float32Array.from([100, -100])))
    expect(back[0]).toBeCloseTo(8, 1)
    expect(back[1]).toBeCloseTo(-8, 1)
  })
})
