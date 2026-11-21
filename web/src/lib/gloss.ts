/** Glose d'un signe que le modèle n'a pas reconnu avec assez de certitude (voir api/app/pipeline.py). */
export const UNKNOWN_GLOSS = '?'

/** Texte affiché pour une glose : « signe non reconnu » plutôt qu'un point d'interrogation obscur. */
export function glossText(gloss: string): string {
  return gloss === UNKNOWN_GLOSS ? 'signe non reconnu' : gloss
}
