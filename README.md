# Sikia

Traduction de la langue des signes en texte, sur téléphone. L'architecture est décrite dans
[docs/architecture.md](docs/architecture.md).

## Structure

| Dossier | Rôle | État |
| --- | --- | --- |
| `web/` | PWA React + TypeScript : caméra, MediaPipe, enregistrement, flux vers l'API | Étape 1 : socle prêt |
| `api/` | Backend FastAPI : WebSocket `/v1/stream`, `/v1/feedback` | Serveur **factice** (reconnaissance et texte simulés) |
| `ml/` | Entraînement PyTorch, export ONNX | À faire |
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
- [x] API factice et flux de bout en bout (testé : 21 tests Python, 13 tests web, essai WebSocket réel)
- [ ] Mesure des performances sur un téléphone milieu de gamme (cible : ≥ 15 i/s)
- [ ] Premier modèle de signes isolés (`ml/`), à brancher à la place de `StubRecognizer`
- [ ] Traducteur LLM à la place de `StubTranslator`, écran de correction (`/v1/feedback` existe déjà)
