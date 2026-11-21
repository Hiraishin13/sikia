import type { Sentence } from './stream'

/** Correction envoyée à /v1/feedback. Texte et gloses seulement : jamais de vidéo ni de points clés. */
export type FeedbackPayload =
  | { kind: 'correct_sentence'; sentence_id: string; glosses: string[]; expected: string }
  | { kind: 'wrong_sign'; sentence_id: string; glosses: string[]; gloss_index: number; expected: string }

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

export function signCorrection(sentence: Sentence, glossIndex: number, expected: string): FeedbackPayload {
  return {
    kind: 'wrong_sign',
    sentence_id: sentence.sentence_id,
    glosses: glossNames(sentence),
    gloss_index: glossIndex,
    expected: expected.trim().toUpperCase(),
  }
}

/** Renvoie true si le serveur a enregistré la correction. Ne lève jamais : l'UI affiche l'échec. */
export async function sendFeedback(payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl('/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    return false
  }
}
