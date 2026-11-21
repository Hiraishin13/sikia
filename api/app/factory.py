"""Choix des briques du pipeline selon l'environnement (aucun secret dans le code)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from .pipeline import Recognizer, StubRecognizer, StubTranslator, Translator

log = logging.getLogger("sikia")

API_DIR = Path(__file__).resolve().parents[1]


def load_env_files(paths: list[Path] | None = None) -> None:
    """Lit api/.env (ignoré par git) : lignes CLE=valeur. Une variable déjà définie l'emporte.

    Désactivé par SIKIA_NO_DOTENV=1 (les tests ne doivent jamais utiliser une vraie clé).
    """
    if os.environ.get("SIKIA_NO_DOTENV"):
        return
    for path in paths or [API_DIR / ".env", Path(".env")]:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def build_translator() -> Translator:
    """SIKIA_TRANSLATOR = claude | gemini | stub | auto.

    auto (défaut) : Claude si ANTHROPIC_API_KEY est définie, sinon Gemini si GEMINI_API_KEY l'est,
    sinon traducteur factice. « llm » est un ancien nom de « claude ».
    """
    load_env_files()
    choice = os.environ.get("SIKIA_TRANSLATOR", "auto").lower()
    if choice == "llm":
        choice = "claude"
    if choice == "auto":
        if os.environ.get("ANTHROPIC_API_KEY"):
            choice = "claude"
        elif os.environ.get("GEMINI_API_KEY"):
            choice = "gemini"
        else:
            choice = "stub"

    if choice == "claude":
        from .llm import LLMTranslator

        translator = LLMTranslator()
        log.info("traducteur Claude : %s", translator.model)
        return translator
    if choice == "gemini":
        from .gemini import GeminiTranslator

        translator = GeminiTranslator()
        log.info("traducteur Gemini : %s", translator.model)
        return translator
    if choice != "stub":
        raise ValueError(f"SIKIA_TRANSLATOR inconnu : {choice!r} (claude, gemini, stub ou auto)")
    log.warning("traducteur FACTICE (définissez ANTHROPIC_API_KEY ou GEMINI_API_KEY)")
    return StubTranslator()


def build_recognizer() -> Recognizer:
    """SIKIA_MODEL_DIR = dossier d'un modèle ONNX (model.onnx + labels.json). Sans lui : reconnaisseur factice.

    Si la variable est définie mais que le modèle est illisible, le serveur refuse de démarrer
    plutôt que de retomber en silence sur le mode factice.
    """
    load_env_files()
    model_dir = os.environ.get("SIKIA_MODEL_DIR")
    if not model_dir:
        log.warning("reconnaissance FACTICE (définissez SIKIA_MODEL_DIR pour utiliser un modèle)")
        return StubRecognizer()
    from .onnx_recognizer import ONNXRecognizer

    recognizer = ONNXRecognizer(model_dir)
    log.info("modèle %s chargé : %d signes", recognizer.version, len(recognizer.labels))
    return recognizer
