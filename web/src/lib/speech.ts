/** Synthèse vocale du navigateur (Web Speech) : gratuite, sans clé, sans serveur. */

export interface VoiceLike {
  lang: string
  name: string
  default?: boolean
  localService?: boolean
}

const norm = (lang: string) => lang.toLowerCase().replace('_', '-')

/** La meilleure voix pour une langue : fr-FR d'abord, puis la voix par défaut, puis une voix locale. */
export function pickVoice<T extends VoiceLike>(voices: T[], lang = 'fr-FR'): T | null {
  const base = norm(lang).split('-')[0]
  const candidates = voices.filter((v) => norm(v.lang).split('-')[0] === base)
  if (candidates.length === 0) return null
  const score = (v: T) =>
    (norm(v.lang) === norm(lang) ? 4 : 0) + (v.default ? 2 : 0) + (v.localService ? 1 : 0)
  return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Les voix se chargent de façon asynchrone : on prévient quand la liste change. Renvoie la fonction d'arrêt. */
export function watchVoices(callback: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!speechSupported()) {
    callback([])
    return () => {}
  }
  const synth = window.speechSynthesis
  const update = () => callback(synth.getVoices())
  update()
  synth.addEventListener('voiceschanged', update)
  return () => synth.removeEventListener('voiceschanged', update)
}

/** Dit `text` à voix haute. Renvoie false si la synthèse vocale n'est pas disponible. */
export function speak(text: string, lang = 'fr-FR'): boolean {
  if (!speechSupported() || !text) return false
  const synth = window.speechSynthesis
  synth.cancel() // une nouvelle phrase remplace la précédente au lieu de s'empiler
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  const voice = pickVoice(synth.getVoices(), lang)
  if (voice) utterance.voice = voice
  synth.speak(utterance)
  return true
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}
