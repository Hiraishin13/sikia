# Sikia

[![CI](https://github.com/Hiraishin13/sikia/actions/workflows/ci.yml/badge.svg)](https://github.com/Hiraishin13/sikia/actions/workflows/ci.yml)

Traduction de la langue des signes en texte, sur téléphone. L'architecture est décrite dans
[docs/architecture.md](docs/architecture.md).

## Structure

| Dossier | Rôle | État |
| --- | --- | --- |
| `web/` | PWA React + TypeScript : caméra, MediaPipe, enregistrement, flux vers l'API | Étape 1 : socle prêt |
| `api/` | Backend FastAPI : WebSocket `/v1/stream`, `/v1/feedback`. Traducteur LLM (Claude Haiku) et reconnaisseur ONNX branchables | Prêt ; sans clé ni modèle, il tourne avec des briques **factices** |
| `ml/` | Entraînement PyTorch, export ONNX ([détails](ml/README.md)) | Chaîne complète testée ; **aucun modèle réel** faute de données |
| `docs/` | Architecture et formats ([points clés](docs/keypoints-format.md)) | |

## Lancer en local

Deux terminaux.

```bash
# 1. API (port 8787 : le 8000 est souvent pris)
cd api
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"      # Windows ; sous Linux/macOS : .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --port 8787 --reload

# 2. App web (télécharge les modèles MediaPipe, ~17 Mo, au premier lancement)
cd web
npm install
npm run dev
```

Ouvrir l'adresse affichée par Vite, autoriser la caméra, cliquer sur **Traduire**. Vite relaie
`/v1/*` vers l'API ; pour une autre adresse : `SIKIA_API_URL=http://localhost:9000 npm run dev`.

La caméra exige HTTPS ou `localhost`. Pour tester sur un téléphone, utiliser un tunnel HTTPS
(ex. `cloudflared tunnel --url http://localhost:5173`) : le proxy Vite gère aussi le WebSocket.

Tests : `npm test` et `npm run lint` dans `web/` ; `python -m pytest` et `python -m ruff check .` dans `api/`.
La CI ([workflow](.github/workflows/ci.yml)) rejoue ces vérifications, plus les types et le build, à chaque push et pull request.

## Configuration de l'API (variables d'environnement)

| Variable | Effet |
| --- | --- |
| `GEMINI_API_KEY` | Traducteur Gemini (offre gratuite, voir ci-dessous). |
| `ANTHROPIC_API_KEY` | Traducteur Claude Haiku 5.5 (payant, ~0,00006 $ la phrase). |
| `SIKIA_TRANSLATOR` | `claude`, `gemini`, `stub` ou `auto` (défaut : Claude si sa clé existe, sinon Gemini, sinon factice). |
| `SIKIA_GEMINI_MODEL` / `SIKIA_LLM_MODEL` | Autre modèle (défauts `gemini-3.5-flash-lite` / `claude-haiku-5-5`). |
| `SIKIA_TRANSLATE_TIMEOUT_S` | Délai avant d'afficher les gloses brutes (défaut 2 ; **4 recommandé avec Gemini gratuit**). |
| `SIKIA_MODEL_DIR` | Dossier d'un modèle ONNX (`ml/runs/vXXXX`). Sans lui : reconnaisseur factice. |
| `SIKIA_FEEDBACK_FILE` | Fichier des corrections (défaut `data/feedback.jsonl`). |

Les variables peuvent aller dans `api/.env` (modèle : [api/.env.example](api/.env.example)), **ignoré par git**.
Ne committez jamais une clé ; si elle a été collée quelque part (chat, ticket), régénérez-la.

### Gemini gratuit : ce qui a été mesuré

Essai en direct le 21/11/2026 (6 enchaînements de gloses, modèle `gemini-3.5-flash-lite`, raisonnement coupé) :
qualité correcte en français, la phrase minimale « MOI MANGER » ne produit rien d'inventé, les cas incohérents sont
signalés incertains. **Mais la latence est irrégulière** : médiane ~1,5 s, p90 ~2,6 s, pire ~5 s, et des erreurs
503 (« forte demande ») ou 429 (limite) apparaissent. Avec le budget de 2 s de l'architecture, environ la moitié des
phrases retomberaient en gloses brutes. Convient au développement et aux démonstrations ; pour le pilote, prévoir Claude
Haiku (payant) ou relever `SIKIA_TRANSLATE_TIMEOUT_S`. Les modèles 2.5 ne sont plus ouverts aux nouveaux comptes
(404) : `scripts/list_gemini_models.py` liste ceux de votre clé, `scripts/live_check.py` mesure qualité et latence.
Les prompts de l'offre gratuite peuvent servir à améliorer les produits de Google : le traducteur n'envoie que du
texte (gloses et phrases précédentes), jamais de vidéo ni de points clés.

## Mesurer les performances sur un téléphone

Ouvrir l'app avec `?debug` dans l'adresse (via le tunnel HTTPS), activer la caméra : un panneau affiche les images
par seconde, le temps par étape (mains, pose, visage), le calcul utilisé (GPU ou processeur) et le verdict face à la
cible de 15 i/s. **Copier le rapport** donne un texte à coller dans un ticket. `?debug&facestride=3` ne recalcule le
visage qu'une image sur trois (une sur deux par défaut).

## Protocole `/v1/stream`

Le client envoie des paquets binaires de 10 images de points clés (~5,5 Ko, un toutes les 330 ms),
format dans [api/app/protocol.py](api/app/protocol.py). Le serveur répond en JSON :

| Message | Quand | Contenu |
| --- | --- | --- |
| `ready` | à la connexion | version du protocole |
| `partial` | un signe vient de finir | gloses de la phrase en cours, avec alternatives |
| `final` | pause longue | gloses + `text` (null si mode dégradé) + `uncertain` |
| `error` | paquet invalide | `code`, `message` (le flux continue) |

Si le traducteur ne répond pas en 2 s, `final` arrive avec `degraded: true` et le client affiche les gloses brutes.

## État

- [x] Étape 1 · caméra, MediaPipe, normalisation, enregistrement et export de signes
- [x] API et flux de bout en bout, CI GitHub Actions (web, api, ml)
- [x] Traducteur Gemini **essayé en direct** (qualité bonne, latence irrégulière : voir ci-dessus) ; traducteur Claude testé seulement avec un faux client, jamais en direct
- [x] Écran de correction : phrase ou signe, alternatives proposées, envoi à `/v1/feedback`
- [x] Chaîne d'entraînement : données → modèle → ONNX → serveur (testée sur données **synthétiques**)
- [x] **Onglet Gestes** : reconnaisseur de gestes de Google (7 gestes), pourcentages en direct, voix française. Testé avec de vraies photos de mains (4/4 reconnus). Ce ne sont pas des signes d'une langue des signes
- [x] Convertisseur Google ISLR (ASL) → format Sikia, testé sur des fichiers au format Kaggle ; **jamais lancé sur le vrai jeu de données** (compte Kaggle requis), voir [ml/README.md](ml/README.md)
- [x] Outil de mesure des performances (`?debug`)
- [ ] **Mesure sur un vrai téléphone milieu de gamme** (cible ≥ 15 i/s) : l'outil est prêt, la mesure reste à faire
- [ ] **Entraînement sur Google ISLR** (signes ASL) : télécharger le jeu (~40 Go), entraîner sur GPU, brancher le modèle
- [ ] **Voix lingala** : traduction français → lingala (à faire valider par des locuteurs) puis synthèse vocale ; la voix française existe déjà
- [ ] **Collecte de vrais signes** (20 à 50 signeurs) puis premier modèle réel : aucun résultat de précision n'existe
- [ ] Essai du traducteur Claude avec une clé Anthropic, et comparaison de sa latence à celle de Gemini (cible 300–600 ms)
