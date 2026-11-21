"""Essai EN DIRECT du traducteur configuré (clé dans api/.env ou dans l'environnement).

    cd api && .venv/Scripts/python scripts/live_check.py [modèle]

Envoie ~6 petites requêtes au fournisseur (quelques centimes au maximum, gratuit sur une offre gratuite),
affiche la phrase obtenue et la latence. À lancer après avoir changé de clé, de modèle ou de fournisseur.
"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.factory import build_translator
from app.pipeline import GlossCandidate, StubTranslator


def g(name, conf, *alts):
    return [GlossCandidate(name, conf), *(GlossCandidate(a, c) for a, c in alts)]


CASES = {
    "temps + verbe": [g("HIER", 0.9), g("MOI", 0.9), g("POISSON", 0.85), g("MANGER", 0.9)],
    "question": [g("TOI", 0.9), g("NOM", 0.9), g("QUOI", 0.85)],
    "lieu + état": [g("MAISON", 0.9), g("MOI", 0.9), g("RENTRER", 0.85), g("FATIGUÉ", 0.9)],
    "signe incertain": [g("MERCI", 0.5, ("OUI", 0.3)), g("BEAUCOUP", 0.9)],
    "minimal (rien à inventer)": [g("MOI", 0.9), g("MANGER", 0.9)],
    "gloses incohérentes": [g("CHAT", 0.9), g("DEMAIN", 0.9), g("FROID", 0.4, ("CHAUD", 0.35))],
}


async def main() -> int:
    translator = build_translator()
    if len(sys.argv) > 1:
        translator.model = sys.argv[1]
    if isinstance(translator, StubTranslator):
        print("Aucune clé configurée : traducteur factice. Définissez GEMINI_API_KEY ou ANTHROPIC_API_KEY.")
        return 2
    print(f"Fournisseur : {type(translator).__name__}, modèle : {translator.model}\n")
    times, failures = [], 0
    for name, glosses in CASES.items():
        t0 = time.perf_counter()
        try:
            out = await translator.translate(glosses, ["Bonjour."])
        except Exception as e:  # noqa: BLE001 - diagnostic : on rapporte tout échec
            failures += 1
            print(f"ÉCHEC | {name:26} | {type(e).__name__}: {str(e)[:120]}")
            continue
        ms = (time.perf_counter() - t0) * 1000
        times.append(ms)
        print(f"{ms:5.0f} ms | {name:26} | {out.text!r}{'  (incertain)' if out.uncertain else ''}")
    if times:
        print(f"\nlatence médiane {sorted(times)[len(times) // 2]:.0f} ms, max {max(times):.0f} ms (budget serveur : 2000 ms)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
