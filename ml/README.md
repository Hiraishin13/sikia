# ml — modèle de signes isolés

Conv1D + Transformer (~3 M de paramètres) sur séquences de points clés, entraîné avec PyTorch, servi en ONNX
par `api/`. Le prétraitement est **partagé** avec le serveur (`api/app/preprocess.py`) : une seule définition,
pour qu'entraînement et production voient exactement les mêmes entrées.

## Ce qui est fait — et ce qui ne l'est pas

- **Fait et testé** : chargement des enregistrements de l'app, découpage par signeur, augmentations
  (miroir pour les gauchers, rotation, échelle, vitesse, occlusions), entraînement, évaluation top-1/top-5,
  export ONNX, vérification PyTorch ≈ ONNX Runtime, chargement par le serveur.
- **Pas fait** : un modèle qui reconnaît de VRAIS signes. Il n'existe encore aucune donnée réelle.
  Le seul modèle entraînable aujourd'hui l'est sur des données **synthétiques** (`--synthetic`), qui servent
  à vérifier la chaîne et ne disent rien de la précision réelle.

## Installation

```bash
cd ml
python -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu   # sans GPU
.venv/Scripts/python -m pip install -e ../api -e ".[dev]"
.venv/Scripts/python -m pytest -q
```

## Étape 2 · entraîner sur Google ISLR (signes ASL, jeu public)

Jeu **Google Isolated Sign Language Recognition** : 250 signes de la langue des signes **américaine (ASL)**, ~94 000
séquences déjà en points MediaPipe. L'application reconnaîtrait donc des signes américains, pas la LSF ni la langue
des signes congolaise. Le convertisseur ([sikia_ml/islr.py](sikia_ml/islr.py)) est écrit et testé sur des fichiers
au format Kaggle ; **il n'a jamais tourné sur le vrai jeu de données**, qui demande un compte Kaggle.

1. Créer un compte Kaggle, accepter les règles de la compétition et **lire la licence** :
   https://www.kaggle.com/competitions/asl-signs/data
2. Télécharger (~40 Go) : `kaggle competitions download -c asl-signs`, puis décompresser dans `ml/data/islr/`
   (il faut `train.csv`, `train_landmark_files/`).
3. Entraîner. Sans carte graphique, prévoir **plusieurs heures** : préférez Google Colab (GPU gratuit, `cuda` est
   détecté automatiquement) ou commencez petit pour valider :

```bash
# essai rapide (quelques minutes) : 20 exemples par signe, 5 époques
.venv/Scripts/python -m sikia_ml.train --islr data/islr --islr-max-per-sign 20 --epochs 5
# entraînement sérieux (GPU conseillé)
.venv/Scripts/python -m sikia_ml.train --islr data/islr --islr-max-per-sign 150 --epochs 60
```

`--islr-max-per-sign` borne la mémoire : le jeu complet ne tient pas en RAM. Le découpage se fait **par signeur**
(les participants d'ISLR), donc le score affiché est celui sur des personnes jamais vues.

Écarts à prévoir avec l'app : les points d'ISLR viennent de MediaPipe Holistic (ancienne API) et non des modèles
« Tasks » de l'app ; le format d'image d'origine est inconnu (l'entraînement étire l'axe x au hasard pour s'y
adapter). La précision réelle dans l'app sera inférieure à celle du jeu de test : à mesurer, pas à supposer.

## Entraîner sur de vraies données (enregistrements de l'app)

1. Chaque signeur ouvre l'app, onglet **Contribuer**, saisit un **pseudo** (jamais un nom), puis enregistre
   chaque signe du vocabulaire ~10 fois et clique sur **Exporter**. Un fichier `.json` par enregistrement.
2. Rassembler tous les fichiers dans un dossier, par exemple `ml/data/`.
3. Entraîner :

```bash
.venv/Scripts/python -m sikia_ml.train --data data --epochs 60
```

Sortie dans `runs/vAAAAMMJJ-HHMMSS/` : `model.onnx`, `labels.json`, `metrics.json` (précision par signe,
signes les plus faibles à re-collecter en priorité).

4. Servir ce modèle :

```bash
SIKIA_MODEL_DIR=ml/runs/v20261121-101500  python -m uvicorn app.main:app --port 8787   # depuis api/
```

Sans `SIKIA_MODEL_DIR`, l'API garde son reconnaisseur factice. Si la variable est définie mais que le modèle
est illisible, l'API refuse de démarrer plutôt que de retomber en silence sur le factice. Revenir en arrière =
pointer vers l'ancien dossier.

## Lire les résultats sans se tromper

- `signer_independent: true` : le jeu de validation ne contient que des signeurs absents de l'entraînement.
  C'est le seul score qui compte. Avec `false` (moins de 2 pseudos), le score est optimiste.
- Objectifs du MVP : top-1 ≥ 80 %, top-5 ≥ 95 % sur signeurs jamais vus (`meets_mvp_targets`).
- Le premier facteur de précision est la **diversité des signeurs** (20 à 50 prévus), pas la taille du modèle.

## Limites connues

- Le serveur ne comble pas les trous courts de mains (l'app le fait à l'enregistrement) : léger écart
  entre données d'entraînement et flux en direct, à mesurer dès qu'il y aura de vraies données.
- Signes isolés seulement. Les phrases continues (CTC) viennent à l'étape suivante.
