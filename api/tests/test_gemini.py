import asyncio
import json

import httpx
import pytest

from app.factory import build_translator, load_env_files
from app.gemini import DEFAULT_MODEL, GEMINI_SCHEMA, GeminiTranslator, thinking_config
from app.llm import LLMTranslator
from app.pipeline import GlossCandidate, StubTranslator
from app.translator_base import TranslationError

KEY = "AQ.cle-de-test-secrete"
GLOSSES = [[GlossCandidate("MOI", 0.9)], [GlossCandidate("DEMAIN", 0.9)], [GlossCandidate("MANGER", 0.9)]]
GOOD = {"text": "Demain, je mange.", "uncertain": False, "covered": [1, 2, 3]}


def run(coro):
    return asyncio.run(coro)


def make(handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=2)
    return GeminiTranslator(api_key=KEY, client=client)


def answer(payload=GOOD, finish="STOP", extra=None):
    body = {
        "candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 500, "candidatesTokenCount": 30},
    }
    return httpx.Response(200, json={**body, **(extra or {})})


def test_requete_bien_formee_et_cle_en_en_tete():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"], seen["headers"], seen["body"] = str(request.url), request.headers, json.loads(request.content)
        return answer()

    out = run(make(handler).translate(GLOSSES, ["Bonjour."]))
    assert out.text == "Demain, je mange." and out.uncertain is False

    assert DEFAULT_MODEL in seen["url"] and seen["url"].endswith(":generateContent")
    assert KEY not in seen["url"]  # la clé ne doit jamais figurer dans l'adresse (donc ni dans les journaux)
    assert seen["headers"]["x-goog-api-key"] == KEY

    body = seen["body"]
    assert body["systemInstruction"]["parts"][0]["text"]
    assert "- Bonjour." in body["contents"][0]["parts"][0]["text"]
    cfg = body["generationConfig"]
    assert cfg["temperature"] == 0 and cfg["responseMimeType"] == "application/json"
    assert cfg["responseSchema"] == GEMINI_SCHEMA
    assert cfg["thinkingConfig"] == {"thinkingLevel": "minimal"}


def test_le_schema_gemini_est_en_majuscules_sans_additional_properties():
    assert GEMINI_SCHEMA["type"] == "OBJECT"
    assert GEMINI_SCHEMA["properties"]["covered"]["items"]["type"] == "INTEGER"
    assert "additionalProperties" not in GEMINI_SCHEMA


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("gemini-3.5-flash-lite", {"thinkingLevel": "minimal"}),
        ("gemini-flash-lite-latest", {"thinkingLevel": "minimal"}),
        ("gemini-2.5-flash", {"thinkingBudget": 0}),
        ("autre-modele", None),
    ],
)
def test_raisonnement_coupe_selon_la_famille_de_modele(model, expected):
    assert thinking_config(model) == expected


@pytest.mark.parametrize(
    "response",
    [
        answer(finish="SAFETY"),
        answer(finish="MAX_TOKENS"),
        httpx.Response(200, json={"candidates": []}),
        httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}, "candidates": []}),
        httpx.Response(200, json={"candidates": [{"content": {"parts": []}, "finishReason": "STOP"}]}),
    ],
)
def test_reponses_inexploitables_levent_une_erreur(response):
    with pytest.raises(TranslationError):
        run(make(lambda request: response).translate(GLOSSES))


def test_erreur_http_est_propagee_sans_reveler_la_cle():
    tr = make(lambda request: httpx.Response(404, json={"error": {"message": "modèle retiré"}}))
    with pytest.raises(httpx.HTTPStatusError) as exc:
        run(tr.translate(GLOSSES))
    assert KEY not in str(exc.value)


def test_cache_evite_un_second_appel():
    calls = []

    def handler(request):
        calls.append(1)
        return answer()

    tr = make(handler)
    run(tr.translate(GLOSSES))
    run(tr.translate(GLOSSES, ["Autre contexte."]))
    assert len(calls) == 1


def test_cle_manquante(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        GeminiTranslator()


class TestFactory:
    @pytest.fixture(autouse=True)
    def clean(self, monkeypatch):
        for var in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "SIKIA_TRANSLATOR"):
            monkeypatch.delenv(var, raising=False)

    def test_sans_cle_traducteur_factice(self):
        assert isinstance(build_translator(), StubTranslator)

    def test_auto_prefere_claude_puis_gemini(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", KEY)
        assert isinstance(build_translator(), GeminiTranslator)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        assert isinstance(build_translator(), LLMTranslator)

    def test_choix_explicite_l_emporte(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", KEY)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("SIKIA_TRANSLATOR", "gemini")
        assert isinstance(build_translator(), GeminiTranslator)
        monkeypatch.setenv("SIKIA_TRANSLATOR", "stub")
        assert isinstance(build_translator(), StubTranslator)

    def test_nom_inconnu_refuse(self, monkeypatch):
        monkeypatch.setenv("SIKIA_TRANSLATOR", "chatgpt")
        with pytest.raises(ValueError, match="inconnu"):
            build_translator()


def test_load_env_files(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# commentaire\nGEMINI_API_KEY='abc'\nDEJA=nouveau\n\nSANS_EGAL\n", encoding="utf-8")
    monkeypatch.delenv("SIKIA_NO_DOTENV", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("DEJA", "existant")
    load_env_files([env])
    import os

    assert os.environ["GEMINI_API_KEY"] == "abc"  # guillemets retirés
    assert os.environ["DEJA"] == "existant"  # une variable déjà définie l'emporte
    monkeypatch.delenv("GEMINI_API_KEY")


def test_load_env_files_desactive_pour_les_tests(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("SIKIA_PIEGE=1\n", encoding="utf-8")
    monkeypatch.setenv("SIKIA_NO_DOTENV", "1")
    load_env_files([env])
    import os

    assert "SIKIA_PIEGE" not in os.environ
