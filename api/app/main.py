"""API Sikia : WebSocket /v1/stream (points clés → gloses → phrase) et /v1/feedback."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .pipeline import GlossCandidate, Recognizer, StubRecognizer, StubTranslator, Translator
from .protocol import PROTOCOL_VERSION, ProtocolError, decode_packet
from .session import Segmenter

log = logging.getLogger("sikia")

#: au-delà, l'app affiche les gloses brutes (mode dégradé, voir l'architecture)
TRANSLATE_TIMEOUT_S = 2.0


def _gloss_json(candidates: list[list[GlossCandidate]]) -> list[dict]:
    return [
        {"gloss": c[0].gloss, "confidence": round(c[0].confidence, 3),
         "alternatives": [{"gloss": a.gloss, "confidence": round(a.confidence, 3)} for a in c[1:]]}
        for c in candidates
        if c
    ]


class FeedbackIn(BaseModel):
    """Correction d'un utilisateur. Ne contient jamais de vidéo ni de points clés."""

    kind: Literal["wrong_sign", "correct_sentence"]
    sentence_id: str | None = Field(default=None, max_length=64)
    #: gloses telles qu'affichées, pour retrouver quel signe était concerné
    glosses: list[str] = Field(default_factory=list, max_length=50)
    expected: str = Field(max_length=500)


def create_app(
    recognizer: Recognizer | None = None,
    translator: Translator | None = None,
    feedback_path: Path | None = None,
) -> FastAPI:
    app = FastAPI(title="Sikia API", version="0.1.0")
    recognizer = recognizer or StubRecognizer()
    translator = translator or StubTranslator()
    feedback_path = feedback_path or Path(os.environ.get("SIKIA_FEEDBACK_FILE", "data/feedback.jsonl"))

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {
            "service": "sikia-api",
            "message": "C'est l'API, pas l'application. Ouvrez l'app web (npm run dev, port 5173).",
            "docs": "/docs",
            "health": "/healthz",
        }

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok"}

    @app.post("/v1/feedback", status_code=202)
    def feedback(body: FeedbackIn) -> dict:
        feedback_path.parent.mkdir(parents=True, exist_ok=True)
        record = {"at": time.time(), **body.model_dump()}
        with feedback_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return {"status": "recorded"}

    @app.websocket("/v1/stream")
    async def stream(ws: WebSocket) -> None:
        await ws.accept()
        segmenter = Segmenter(recognizer)
        sentence_no = 0
        await ws.send_json({"type": "ready", "version": PROTOCOL_VERSION})
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    return

                if (text := message.get("text")) is not None:
                    if _is_reset(text):
                        segmenter.reset()
                    continue

                try:
                    packet = decode_packet(message["bytes"])
                except ProtocolError as e:
                    await ws.send_json({"type": "error", "code": "bad_packet", "message": str(e)})
                    continue

                events = segmenter.push(packet.frames)

                if events.sign_added:
                    sentence_so_far = segmenter.current_glosses
                    await ws.send_json(
                        {"type": "partial", "seq": packet.seq, "glosses": _gloss_json(sentence_so_far)}
                    )

                if events.sentence is not None:
                    sentence_no += 1
                    out = {
                        "type": "final",
                        "seq": packet.seq,
                        "sentence_id": f"s{sentence_no}",
                        "glosses": _gloss_json(events.sentence),
                    }
                    try:
                        tr = await asyncio.wait_for(
                            translator.translate(events.sentence), TRANSLATE_TIMEOUT_S
                        )
                        out |= {"text": tr.text, "uncertain": tr.uncertain, "degraded": False}
                    except Exception:  # délai dépassé ou API en panne : on n'interrompt pas le flux
                        log.warning("traduction indisponible, mode dégradé", exc_info=True)
                        out |= {"text": None, "uncertain": True, "degraded": True}
                    await ws.send_json(out)
        except WebSocketDisconnect:
            return

    return app


def _is_reset(text: str) -> bool:
    try:
        return json.loads(text).get("type") == "reset"
    except (ValueError, AttributeError):
        return False


app = create_app()
