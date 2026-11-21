import { describe, expect, it } from 'vitest'
import { formatReport, meetsTarget, percentile, slowestStage, summarize, type FrameTiming } from './perf'

const t = (total: number, hands = 10, pose = 5, face: number | null = 8): FrameTiming => ({ total, hands, pose, face })

describe('percentile', () => {
  it('médiane et pire 5 %', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(95)
  })
  it('liste vide', () => expect(percentile([], 50)).toBe(0))
})

describe('summarize', () => {
  it('calcule les images par seconde sur la fenêtre', () => {
    const stats = summarize(Array.from({ length: 30 }, () => t(30)), 2000)!
    expect(stats.fps).toBe(15)
    expect(meetsTarget(stats)).toBe(true)
  })

  it('sous la cible : non atteinte', () => {
    expect(meetsTarget(summarize(Array.from({ length: 20 }, () => t(60)), 2000)!)).toBe(false) // 10 i/s
  })

  it("ignore les étapes visage sautées dans la médiane du visage", () => {
    const samples = [t(20, 10, 5, 12), t(15, 10, 5, null), t(20, 10, 5, 12), t(15, 10, 5, null)]
    expect(summarize(samples, 1000)!.stages.face).toBe(12)
  })

  it('aucune image : pas de statistiques', () => expect(summarize([], 1000)).toBeNull())

  it("désigne l'étape la plus lente", () => {
    expect(slowestStage(summarize([t(40, 25, 5, 10)], 1000)!)).toBe('hands')
    expect(slowestStage(summarize([t(40, 5, 25, 10)], 1000)!)).toBe('pose')
    expect(slowestStage(summarize([t(40, 5, 10, 25)], 1000)!)).toBe('face')
  })
})

describe('formatReport', () => {
  it('contient le verdict, les étapes et le matériel', () => {
    const stats = summarize(Array.from({ length: 12 }, () => t(80)), 1000)!
    const text = formatReport(
      stats,
      { hands: 'GPU', pose: 'GPU', face: 'CPU' },
      { userAgent: 'TestUA', cores: 8, memoryGb: 4, video: '640×480' },
      2,
    )
    expect(text).toContain('12.0 i/s')
    expect(text).toContain('NON atteinte')
    expect(text).toContain('visage CPU')
    expect(text).toContain('1 image sur 2')
    expect(text).toContain('8 cœurs')
  })
})
