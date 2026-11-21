"""Liste les modèles Gemini réellement utilisables avec votre clé (les noms changent vite).

    cd api && .venv/Scripts/python scripts/list_gemini_models.py

Un modèle absent de cette liste, ou « no longer available to new users » (404), doit être remplacé :
SIKIA_GEMINI_MODEL=<nom> dans api/.env.
"""

import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.factory import load_env_files

load_env_files()
key = os.environ.get("GEMINI_API_KEY")
if not key:
    raise SystemExit("GEMINI_API_KEY n'est pas défini (api/.env ou environnement).")

r = httpx.get(
    "https://generativelanguage.googleapis.com/v1beta/models",
    params={"pageSize": 200},
    headers={"x-goog-api-key": key},  # en-tête : la clé ne figure pas dans l'adresse
    timeout=20,
)
r.raise_for_status()
for m in sorted(r.json()["models"], key=lambda m: m["name"]):
    if "generateContent" in m.get("supportedGenerationMethods", []) and "gemini" in m["name"]:
        print(m["name"].removeprefix("models/"))
