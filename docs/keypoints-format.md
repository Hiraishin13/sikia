# Format des points clés Sikia (v1)

Contrat entre le client (`web/`), le serveur (`api/`) et l'entraînement (`ml/`).
Source de vérité côté code : [`web/src/lib/landmarks.ts`](../web/src/lib/landmarks.ts).

## Une image

Vecteur de **273 nombres** (`VALUES_PER_FRAME`), chaque point = `x, y, z` :

| Segment | Points | Offset | Source MediaPipe |
| --- | --- | --- | --- |
| Main gauche | 21 | 0 | Hand Landmarker (étiquette `Left` = main gauche du signeur) |
| Main droite | 21 | 63 | Hand Landmarker (`Right`) |
| Pose | 7 | 126 | Pose Landmarker, indices 0 (nez), 11–12 (épaules), 13–14 (coudes), 15–16 (poignets) |
| Visage | 42 | 147 | Face Landmarker : 20 lèvres, 10 sourcils, 12 yeux (liste dans `FACE_INDICES`) |

Un segment absent (main non détectée…) est rempli de zéros et son drapeau est à 0.

## Normalisation

- Origine : milieu des épaules (pose 11 et 12).
- Échelle : largeur des épaules, mesurée après avoir redonné des proportions réelles à x et y
  (x est multiplié par `largeur/hauteur` de la vidéo). z suit la même échelle que x.
- Si une épaule est introuvable ou de visibilité < 0,5, l'image est marquée `valid = 0` et tout est à zéro.
- Les trous de main de **4 images ou moins** sont comblés par interpolation linéaire à l'arrêt de l'enregistrement.

## Quantification

`int16 = round(valeur × 4096)`, saturé à ±8 largeurs d'épaules. Une image = 546 octets, soit ~16 Ko/s à 30 i/s.

## Fichier d'enregistrement (`.json`)

```json
{
  "version": 1,
  "label": "BONJOUR",
  "signer": "pseudo-du-signeur",
  "createdAt": "2026-11-21T10:00:00.000Z",
  "layout": { "valuesPerFrame": 273, "quantScale": 4096, "segments": { "...": "..." } },
  "frames": [{ "t": 0, "flags": [1, 1, 0, 1], "q": [0, 0, "... 273 entiers"] }]
}
```

`flags` = `[valid, mainGauche, mainDroite, visage]`, `t` en ms depuis le début.

`signer` est un **pseudo** (jamais un nom), saisi dans l'onglet Contribuer : l'entraînement s'en sert pour que
le jeu de test ne contienne que des personnes absentes de l'entraînement (`ml/`, découpage par signeur).
