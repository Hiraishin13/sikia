import type { Sentence } from './stream'

/** Correction envoyée à /v1/feedback. Texte et gloses seulement : jamais de vidéo ni de points clés. */
export type FeedbackPayload =
  | { kind: 'correct_sentence'; sentence_id: string; glosses: string[]; expected: string }
  | {
      kind: 'wrong_sign'
      sentence_id: string
      glosses: string[]
      gloss_index: number
      expected: string
      /** Consentement explicite : conserver les points clés de ce geste (jamais la vidéo). */
      share_keypoints?: boolean
      session_id?: string
    }

export function glossNames(sentence: Sentence): string[] {
  return sentence.glosses.map((g) => g.gloss)
}

export function sentenceCorrection(sentence: Sentence, expected: string): FeedbackPayload {
  return {
    kind: 'correct_sentence',
    sentence_id: sentence.sentence_id,
    glosses: glossNames(sentence),
    expected: expected.trim(),
  }
}

export function signCorrection(
  sentence: Sentence,
  glossIndex: number,
  expected: string,
  share?: { sessionId: string },
): FeedbackPayload {
  return {
    kind: 'wrong_sign',
    sentence_id: sentence.sentence_id,
    glosses: glossNames(sentence),
    gloss_index: glossIndex,
    expected: expected.trim().toUpperCase(),
    ...(share ? { share_keypoints: true, session_id: share.sessionId } : {}),
  }
}

export interface FeedbackResult {
  ok: boolean
  /** Vrai si le serveur a conservé les points clés du geste (consentement donné et phrase encore en mémoire). */
  shared: boolean
}

/** Ne lève jamais : l'interface affiche l'échec. */
export async function sendFeedback(payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<FeedbackResult> {
  try {
    const res = await fetchImpl('/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { ok: false, shared: false }
    const body = (await res.json().catch(() => ({}))) as { shared?: boolean }
    return { ok: true, shared: body.shared === true }
  } catch {
    return { ok: false, shared: false }
  }
}
