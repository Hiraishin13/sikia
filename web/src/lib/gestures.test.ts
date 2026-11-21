import { describe, expect, it } from 'vitest'
import { GESTURES, createStabilizer, gestureInfo, type GestureName, type GestureScores } from './gestures'
import { pickVoice } from './speech'

const thumb: GestureScores = { Thumb_Up: 0.95, None: 0.03, Victory: 0.02 }
const none: GestureScores = { None: 0.97, Thumb_Up: 0.03 }

/** Envoie la même image n fois et renvoie les gestes confirmés. */
function feed(update: ReturnType<typeof createStabilizer>, scores: GestureScores | null, n: number) {
  const confirmed: string[] = []
  for (let i = 0; i < n; i++) {
    const c = update(scores).confirmed
    if (c) confirmed.push(c)
  }
  return confirmed
}

describe('catalogue des gestes', () => {
  it('chaque geste du modèle de Google a un nom français', () => {
    const names: GestureName[] = ['None', 'Closed_Fist', 'Open_Palm', 'Pointing_Up', 'Thumb_Down', 'Thumb_Up', 'Victory', 'ILoveYou']
    for (const n of names) expect(GESTURES[n].label.length).toBeGreaterThan(0)
  })

  it("« Aucun geste » ne dit rien ; les autres ont une phrase", () => {
    expect(GESTURES.None.phrase).toBeNull()
    expect(GESTURES.Thumb_Up.phrase).toBeTruthy()
  })

  it('un geste inconnu ne plante pas', () => {
    expect(gestureInfo('Nouveau_Geste')).toEqual({ label: 'Nouveau_Geste', phrase: null })
  })
})

describe('stabilisateur', () => {
  it("ne confirme pas un geste vu quelques images seulement (anti-scintillement)", () => {
    expect(feed(createStabilizer(), thumb, 5)).toEqual([])
  })

  it('confirme un geste tenu, une seule fois', () => {
    expect(feed(createStabilizer(), thumb, 40)).toEqual(['Thumb_Up'])
  })

  it('ne confirme pas un geste peu sûr', () => {
    expect(feed(createStabilizer(), { Thumb_Up: 0.5, Victory: 0.4, None: 0.1 }, 40)).toEqual([])
  })

  it("n'annonce jamais « Aucun geste »", () => {
    expect(feed(createStabilizer(), none, 40)).toEqual([])
  })

  it('redit le même geste après un retour à « Aucun geste »', () => {
    const u = createStabilizer()
    expect(feed(u, thumb, 20)).toEqual(['Thumb_Up'])
    feed(u, none, 20)
    expect(feed(u, thumb, 20)).toEqual(['Thumb_Up'])
  })

  it('redit le même geste après que la main a quitté le cadre', () => {
    const u = createStabilizer()
    expect(feed(u, thumb, 20)).toEqual(['Thumb_Up'])
    feed(u, null, 15)
    expect(feed(u, thumb, 20)).toEqual(['Thumb_Up'])
  })

  it("ne redit pas le geste si la main disparaît très brièvement", () => {
    const u = createStabilizer()
    expect(feed(u, thumb, 20)).toEqual(['Thumb_Up'])
    feed(u, null, 3) // perte d'un instant du suivi
    expect(feed(u, thumb, 20)).toEqual([])
  })

  it('enchaîne deux gestes différents', () => {
    const u = createStabilizer()
    const victory: GestureScores = { Victory: 0.96, None: 0.04 }
    expect([...feed(u, thumb, 20), ...feed(u, victory, 30)]).toEqual(['Thumb_Up', 'Victory'])
  })

  it('un scintillement entre deux gestes ne confirme rien', () => {
    const u = createStabilizer()
    const confirmed: string[] = []
    for (let i = 0; i < 40; i++) {
      const c = u(i % 2 === 0 ? thumb : { Victory: 0.95, None: 0.05 }).confirmed
      if (c) confirmed.push(c)
    }
    expect(confirmed).toEqual([])
  })

  it('les probabilités lissées restent entre 0 et 1 et somment ~1', () => {
    const u = createStabilizer()
    let state = u(thumb)
    for (let i = 0; i < 30; i++) state = u(i % 3 === 0 ? none : thumb)
    const sum = Object.values(state.probs).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 1)
    expect(Math.max(...Object.values(state.probs))).toBeLessThanOrEqual(1)
  })

  it('sans main : pas de geste en tête', () => {
    expect(createStabilizer()(null)).toMatchObject({ top: null, topScore: 0, confirmed: null })
  })
})

describe('choix de la voix', () => {
  const v = (lang: string, name: string, extra = {}) => ({ lang, name, ...extra })

  it('préfère fr-FR aux autres variantes du français', () => {
    const chosen = pickVoice([v('fr-CA', 'Canada'), v('fr-FR', 'France'), v('en-US', 'Anglais')])
    expect(chosen?.name).toBe('France')
  })

  it('accepte une autre variante si fr-FR manque, avec les deux écritures (fr_BE / fr-BE)', () => {
    expect(pickVoice([v('en-US', 'Anglais'), v('fr_BE', 'Belgique')])?.name).toBe('Belgique')
  })

  it('préfère la voix par défaut, puis la voix locale (qui marche hors ligne)', () => {
    expect(pickVoice([v('fr-FR', 'A'), v('fr-FR', 'B', { default: true })])?.name).toBe('B')
    expect(pickVoice([v('fr-FR', 'Cloud'), v('fr-FR', 'Locale', { localService: true })])?.name).toBe('Locale')
  })

  it("renvoie null s'il n'y a aucune voix française", () => {
    expect(pickVoice([v('en-US', 'Anglais'), v('de-DE', 'Allemand')])).toBeNull()
    expect(pickVoice([])).toBeNull()
  })
})
