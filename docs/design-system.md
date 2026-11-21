# Charte graphique Sikia

Source de vérité : [`web/src/styles/tokens.css`](../web/src/styles/tokens.css). Ne jamais écrire une couleur
ou un espacement en dur dans un composant : utiliser un jeton.

## Principes

1. **Calme avant tout.** Les neutres portent l'interface ; la couleur ne sert qu'à signaler un état.
2. **Jamais la couleur seule.** Chaque état a une icône et un texte (utilisateurs sourds, daltoniens, plein soleil).
3. **Un seul geste principal par écran** : un grand bouton plein, le reste en contour.
4. **Dire quoi faire**, pas ce qui ne va pas : « Montrez vos deux mains », pas « Mains non détectées ».
5. **Aucun son** ni information transmise par le son seul.

## Couleurs

| Jeton | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| `--paper` | #F5F3EE | #151412 | Fond de page |
| `--surface` | #FFFEFB | #1E1D1A | Champs, bandeau de cadrage |
| `--ink` | #1C1B19 | #EFECE4 | Texte, bouton principal |
| `--ink-2` | #5E5A52 | #A9A499 | Texte secondaire |
| `--line` | #DDD9CF | #35332E | Filets, contours |
| `--accent` | #B4492B | #E27F5C | Attention, enregistrement en cours, marque |
| `--ok` | #2F6B4F | #7CC4A0 | « Bien cadré », bon suivi |
| `--stage` | #0E0D0C | idem | Zone caméra, toujours sombre |

Tous les textes respectent un contraste d'au moins 4,5:1 (WCAG AA) sur leur fond.
Deux teintes seulement : terracotta et vert. Pas de dégradé, pas d'ombre portée, pas de violet.

## Typographie

**Atkinson Hyperlegible** (400 et 700), conçue pour la lisibilité, auto-hébergée (fonctionne hors ligne).
Base 17 px. Échelle : 14 (`--text-s`) · 17 · 20 (`--text-l`) · 32 (`--text-xl`, texte traduit).

## Forme

Rayon unique de 8 px. Séparations par filets de 1 px plutôt que par cartes. Espacements multiples de 4.
Cibles tactiles de 52 px de haut. Focus clavier : contour de 3 px, jamais supprimé.

## Composants

- **Bouton principal** : fond `--ink`. **Arrêt / enregistrement** : fond `--accent`. **Secondaire** : contour `--line`.
- **Bandeau de cadrage** : icône + consigne. Vert si tout va bien, terracotta sinon.
  Le message ne change qu'après ~0,3 s de stabilité pour ne pas clignoter.
- **Guide de cadrage** : silhouette en pointillés, visible seulement quand le cadrage est à corriger.
- **Points sur la vidéo** : un seul ton clair ; les mains en opacité forte, le corps et le visage discrets.
- **Texte traduit** : la dernière phrase en grand (`--text-xl`), les précédentes en `--text-l` ; une phrase
  incertaine ou en mode dégradé reçoit une icône et une explication, jamais un simple grisé.
- **Marque** : une personne vue de face (tête en `--accent`), la même silhouette que le guide de cadrage.

## Débogage

`?debug` à la fin de l'adresse affiche les images par seconde sur la caméra.

## Responsive

La mise en page est **recomposée** selon l'espace et l'orientation, pas seulement réduite.

| Situation | Disposition |
| --- | --- |
| Mobile portrait (< 600 px) | Une colonne. Onglets en **barre du bas** (zone du pouce, avec icônes). Barre d'actions collée juste au-dessus. |
| Tablette portrait (600–899 px) | Une colonne plus aérée, onglets en haut, caméra plafonnée à ~46 % de la hauteur. |
| ≥ 900 px, ou paysage ≥ 560 px | **Deux colonnes** : caméra fixe à gauche (reste visible quand le texte défile), texte et actions à droite. |
| Téléphone en paysage (hauteur ≤ 520 px) | Deux colonnes resserrées : en-tête réduit, caméra dimensionnée sur la hauteur disponible. |

Règles :

- **La caméra se dimensionne par sa hauteur maximale** (`--cam-max-h`) et le **format réel** de la vidéo (`--cam-aspect`, relevé
  sur le flux : un téléphone en portrait renvoie du 3:4). Elle n'est jamais rognée et ne repousse jamais le contenu hors de l'écran.
- **Texte traduit fluide** : `--text-xl` va de 28 px (mobile) à 44 px (grand écran).
- **Marges fluides** : `--gutter` de 16 à 32 px, plus les zones sûres (`env(safe-area-inset-*)`) des téléphones à encoche.
- **Rien ne déborde** : colonnes en `minmax(0, 1fr)`, `overflow-wrap` sur les textes variables (noms de signes, gloses).
- **Tactile** : cibles de 52 px (boutons) et 60 px (barre d'onglets) ; les survols (`:hover`) ne s'appliquent qu'aux appareils à souris.
- **L'ordre du clavier suit l'ordre visuel** : contenu d'abord, actions en dernier dans le panneau.
