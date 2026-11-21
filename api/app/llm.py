"""Traducteur « gloses → phrase » avec Claude (Haiku : rapide et peu coûteux)."""

from __future__ import annotations

import os
import time

import anthropic

from .translator_base import (
    OUTPUT_SCHEMA,
    SYSTEM_PROMPT,
    CachedTranslator,
    TranslationError,
    log,
    render_prompt,
    request_timeout_s,
)

__all__ = ["DEFAULT_MODEL", "OUTPUT_SCHEMA", "LLMTranslator", "TranslationError", "render_prompt"]

#: Surchargeable : SIKIA_LLM_MODEL.
DEFAULT_MODEL = "claude-haiku-5-5"


class LLMTranslator(CachedTranslator):
    def __init__(
        self,
        client: anthropic.AsyncAnthropic | None = None,
        model: str | None = None,
        cache_size: int = 256,
    ) -> None:
        super().__init__(cache_size)
        self.client = client or anthropic.AsyncAnthropic(timeout=request_timeout_s(), max_retries=0)
        self.model = model or os.environ.get("SIKIA_LLM_MODEL", DEFAULT_MODEL)

    async def _complete(self, user_prompt: str) -> str:
        started = time.perf_counter()
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=300,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            # Reformulation courte : pas de raisonnement, effort minimal, sortie JSON garantie.
            thinking={"type": "disabled"},
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
            },
        )
        log.info(
            "traduction Claude en %.0f ms (entrée %s, sortie %s tokens, requête %s)",
            (time.perf_counter() - started) * 1000,
            response.usage.input_tokens,
            response.usage.output_tokens,
            getattr(response, "_request_id", "?"),
        )
        if response.stop_reason != "end_turn":
            # refusal (classifieurs de sécurité), max_tokens… : aucune sortie fiable.
            raise TranslationError(f"arrêt inattendu : {response.stop_reason}")
        text_block = next((b for b in response.content if b.type == "text"), None)
        if text_block is None:
            raise TranslationError("réponse sans texte")
        return text_block.text
