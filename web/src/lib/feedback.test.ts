import { describe, expect, it, vi } from 'vitest'
import type { Sentence } from './stream'
import { sendFeedback, sentenceCorrection, signCorrection } from './feedback'

const g = (gloss: string) => ({ gloss, confidence: 0.8, alternatives: [] })
const sentence: Sentence = {
  type: 'final',
  seq: 1,
  sentence_id: 's7',
  glosses: [g('MOI'), g('MERCI')],
  text: 'Merci.',
  uncertain: false,
  degraded: false,
}

describe('corrections', () => {
  it('une phrase corrigée garde les gloses et nettoie le texte', () => {
    expect(sentenceCorrection(sentence, '  Je te remercie. ')).toEqual({
      kind: 'correct_sentence',
      sentence_id: 's7',
      glosses: ['MOI', 'MERCI'],
      expected: 'Je te remercie.',
    })
  })

  it('un signe faux indique sa position et se normalise en majuscules', () => {
    expect(signCorrection(sentence, 1, ' oui ')).toEqual({
      kind: 'wrong_sign',
      sentence_id: 's7',
      glosses: ['MOI', 'MERCI'],
      gloss_index: 1,
      expected: 'OUI',
    })
  })
})

describe('sendFeedback', () => {
  const payload = sentenceCorrection(sentence, 'Merci beaucoup.')

  it('envoie en JSON vers /v1/feedback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    expect(await sendFeedback(payload, fetchMock as unknown as typeof fetch)).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/v1/feedback')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it("renvoie false si le serveur refuse ou si le réseau tombe, sans lever d'exception", async () => {
    expect(await sendFeedback(payload, vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch)).toBe(false)
    expect(await sendFeedback(payload, vi.fn().mockRejectedValue(new Error('réseau')) as unknown as typeof fetch)).toBe(false)
  })
})
