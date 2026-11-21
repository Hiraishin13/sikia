"""Traducteur « gloses → phrase » avec l'API Gemini de Google (offre gratuite disponible).

Prompt, cache et garde-fous sont partagés avec le traducteur Claude (translator_base.py).
La clé est envoyée dans l'en-tête `x-goog-api-key`, jamais dans l'adresse : ainsi elle n'apparaît
ni dans les journaux d'erreur ni dans les traces.
"""

from __future__ import annotations

import os
import time

import httpx

from .translator_base import (
    OUTPUT_SCHEMA,
    SYSTEM_PROMPT,
    CachedTranslator,
    TranslationError,
    log,
    request_timeout_s,
)

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

#: Rapide et léger. Surchargeable : SIKIA_GEMINI_MODEL (ex. gemini-3.5-flash : plus fin, plus lent).
#: Les modèles 2.5 ne sont plus ouverts aux nouveaux comptes (404) et les noms de modèles Gemini
#: changent vite : en cas de 404, lister les modèles ouverts à la clé (scripts/list_gemini_models.py).
DEFAULT_MODEL = "gemini-3.5-flash-lite"


def _gemini_schema(schema: dict) -> dict:
    """JSON Schema → sous-ensemble OpenAPI de Gemini (types en majuscules, sans additionalProperties)."""
    out = {k: v for k, v in schema.items() if k != "additionalProperties"}
    if "type" in out:
        out["type"] = out["type"].upper()
    if "properties" in out:
        out["properties"] = {k: _gemini_schema(v) for k, v in out["properties"].items()}
    if "items" in out:
        out["items"] = _gemini_schema(out["items"])
    return out


GEMINI_SCHEMA = _gemini_schema(OUTPUT_SCHEMA)


def thinking_config(model: str) -> dict | None:
    """Reformulation courte : on coupe le raisonnement, qui coûte du temps sans rien apporter."""
    if "2.5" in model:
        return {"thinkingBudget": 0}
    if model.startswith("gemini-3") or model.endswith("-latest"):
        return {"thinkingLevel": "minimal"}
    return None


class GeminiTranslator(CachedTranslator):
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        client: httpx.AsyncClient | None = None,
        cache_size: int = 256,
    ) -> None:
        super().__init__(cache_size)
        self._key = api_key or os.environ.get("GEMINI_API_KEY", "")
        if not self._key:
            raise ValueError("GEMINI_API_KEY n'est pas défini")
        self.model = model or os.environ.get("SIKIA_GEMINI_MODEL", DEFAULT_MODEL)
        self.client = client or httpx.AsyncClient(timeout=request_timeout_s())

    def _body(self, user_prompt: str) -> dict:
        config: dict = {
            "temperature": 0,
            "maxOutputTokens": 300,
            "responseMimeType": "application/json",
            "responseSchema": GEMINI_SCHEMA,
        }
        thinking = thinking_config(self.model)
        if thinking:
            config["thinkingConfig"] = thinking
        return {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": config,
        }

    async def _complete(self, user_prompt: str) -> str:
        started = time.perf_counter()
        response = await self.client.post(
            URL.format(model=self.model),
            json=self._body(user_prompt),
            headers={"x-goog-api-key": self._key},
        )
        response.raise_for_status()
        data = response.json()
        usage = data.get("usageMetadata", {})
        log.info(
            "traduction Gemini en %.0f ms (entrée %s, sortie %s tokens)",
            (time.perf_counter() - started) * 1000,
            usage.get("promptTokenCount"),
            usage.get("candidatesTokenCount"),
        )

        block = (data.get("promptFeedback") or {}).get("blockReason")
        if block:
            raise TranslationError(f"requête bloquée : {block}")
        candidates = data.get("candidates") or []
        if not candidates:
            raise TranslationError("aucune réponse")
        candidate = candidates[0]
        if candidate.get("finishReason") != "STOP":
            raise TranslationError(f"arrêt inattendu : {candidate.get('finishReason')}")
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
        if not text:
            raise TranslationError("réponse sans texte")
        return text
