import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.pipeline import GlossCandidate, Translation
from app.protocol import encode_packet
from tests.helpers import pause, sign


def send(ws, seq, frames):
    ws.send_bytes(encode_packet(seq, frames))


def drain_until(ws, kind, limit=10):
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"pas de message {kind}")


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(feedback_path=tmp_path / "feedback.jsonl"))


def test_racine_oriente_vers_lapp(client):
    body = client.get("/").json()
    assert body["service"] == "sikia-api"
    assert body["docs"] == "/docs"


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_flux_complet_partial_puis_final(client):
    with client.websocket_connect("/v1/stream") as ws:
        assert ws.receive_json() == {"type": "ready", "version": 1}

        send(ws, 1, sign(12))
        send(ws, 2, pause(6))
        partial = drain_until(ws, "partial")
        assert len(partial["glosses"]) == 1
        assert partial["glosses"][0]["gloss"]

        send(ws, 3, pause(30))
        final = drain_until(ws, "final")
        assert final["sentence_id"] == "s1"
        assert final["degraded"] is False
        assert final["text"].endswith(".")
        assert len(final["glosses"]) == 1


def test_paquet_invalide_renvoie_une_erreur_sans_couper_le_flux(client):
    with client.websocket_connect("/v1/stream") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x01\x02")
        err = ws.receive_json()
        assert err["type"] == "error" and err["code"] == "bad_packet"

        send(ws, 1, sign(12) + pause(6))
        assert drain_until(ws, "partial")


def test_reset_efface_la_phrase_en_cours(client):
    with client.websocket_connect("/v1/stream") as ws:
        ws.receive_json()
        send(ws, 1, sign(12) + pause(6))
        drain_until(ws, "partial")
        ws.send_text(json.dumps({"type": "reset"}))
        send(ws, 2, pause(30))
        # la phrase a été effacée : aucun « final » ne doit arriver
        send(ws, 3, sign(12) + pause(6))
        partial = drain_until(ws, "partial")
        assert len(partial["glosses"]) == 1


class FailingTranslator:
    async def translate(self, glosses: list[list[GlossCandidate]]) -> Translation:
        raise RuntimeError("API LLM indisponible")


class SlowTranslator:
    async def translate(self, glosses: list[list[GlossCandidate]]) -> Translation:
        await asyncio.sleep(5)
        return Translation("trop tard", False)


@pytest.mark.parametrize("translator", [FailingTranslator(), SlowTranslator()])
def test_mode_degrade_si_le_traducteur_echoue(tmp_path, monkeypatch, translator):
    monkeypatch.setattr("app.main.TRANSLATE_TIMEOUT_S", 0.2)
    client = TestClient(create_app(translator=translator, feedback_path=tmp_path / "f.jsonl"))
    with client.websocket_connect("/v1/stream") as ws:
        ws.receive_json()
        send(ws, 1, sign(12) + pause(30))
        final = drain_until(ws, "final")
        assert final["degraded"] is True
        assert final["text"] is None
        assert final["glosses"], "les gloses brutes doivent rester disponibles"


def test_feedback_est_enregistre(client, tmp_path):
    body = {"kind": "correct_sentence", "sentence_id": "s1", "glosses": ["MOI"], "expected": "Je mange."}
    r = client.post("/v1/feedback", json=body)
    assert r.status_code == 202
    line = (tmp_path / "feedback.jsonl").read_text(encoding="utf-8").strip()
    assert json.loads(line)["expected"] == "Je mange."


def test_feedback_invalide(client):
    assert client.post("/v1/feedback", json={"kind": "autre", "expected": "x"}).status_code == 422
    assert client.post("/v1/feedback", json={"kind": "wrong_sign", "expected": "x" * 501}).status_code == 422
