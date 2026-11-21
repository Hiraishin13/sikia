import asyncio
import json
from types import SimpleNamespace

import pytest

from app.llm import OUTPUT_SCHEMA, LLMTranslator, TranslationError, render_prompt
from app.pipeline import GlossCandidate


def g(name: str, conf: float, *alts: tuple[str, float]) -> list[GlossCandidate]:
    return [GlossCandidate(name, conf), *(GlossCandidate(a, c) for a, c in alts)]


class FakeMessages:
    """Imite client.messages : renvoie des réponses préparées et garde les appels."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def reply(payload, stop_reason="end_turn", text=None):
    body = text if text is not None else json.dumps(payload, ensure_ascii=False)
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=body)],
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=420, output_tokens=30),
    )


def make(*replies) -> tuple[LLMTranslator, FakeMessages]:
    messages = FakeMessages(replies)
    client = SimpleNamespace(messages=messages)
    return LLMTranslator(client=client, model="claude-haiku-5-5"), messages


def run(coro):
    return asyncio.run(coro)


GLOSSES = [g("MOI", 0.9), g("DEMAIN", 0.9), g("MÉDECIN", 0.85), g("ALLER", 0.9)]
GOOD = {"text": "Demain, je vais chez le médecin.", "uncertain": False, "covered": [1, 2, 3, 4]}


def test_traduction_nominale():
    tr, _ = make(reply(GOOD))
    out = run(tr.translate(GLOSSES))
    assert out.text == "Demain, je vais chez le médecin."
    assert out.uncertain is False


def test_la_requete_est_bien_formee():
    tr, messages = make(reply(GOOD))
    run(tr.translate(GLOSSES, ["Bonjour."]))
    call = messages.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_config"]["format"] == {"type": "json_schema", "schema": OUTPUT_SCHEMA}
    assert call["output_config"]["effort"] == "low"
    # Haiku 5.5 refuse les paramètres d'échantillonnage non par défaut
    assert not {"temperature", "top_p", "top_k"} & call.keys()
    prompt = call["messages"][0]["content"]
    assert "- Bonjour." in prompt and "4. ALLER (0.90)" in prompt


def test_le_prompt_montre_les_alternatives():
    text = render_prompt([g("TOI", 0.4, ("MOI", 0.35))], [])
    assert "1. TOI (0.40) — alternatives : MOI 0.35" in text
    assert "Phrases précédentes" not in text


def test_gloses_fortes_non_exprimees_rendent_la_phrase_incertaine():
    # le modèle « oublie » ALLER (glose 4, confiance 0,9) et déclare pourtant tout certain
    tr, _ = make(reply({"text": "Demain, le médecin.", "uncertain": False, "covered": [1, 2, 3]}))
    assert run(tr.translate(GLOSSES)).uncertain is True


def test_une_glose_peu_sure_rend_la_phrase_incertaine_meme_si_le_modele_dit_non():
    glosses = [g("MOI", 0.9), g("BRUIT", 0.3)]
    tr, _ = make(reply({"text": "Moi.", "uncertain": False, "covered": [1]}))
    assert run(tr.translate(glosses)).uncertain is True  # règle déterministe du serveur


@pytest.mark.parametrize(
    "bad",
    [
        reply(None, text="pas du json"),
        reply({"uncertain": False, "covered": []}),  # champ text absent
        reply({"text": "  ", "uncertain": False, "covered": [1]}),  # phrase vide
        reply(GOOD, stop_reason="refusal"),
        reply(GOOD, stop_reason="max_tokens"),
    ],
)
def test_reponses_inexploitables_levent_une_erreur(bad):
    tr, _ = make(bad)
    with pytest.raises(TranslationError):
        run(tr.translate(GLOSSES))


def test_erreur_reseau_est_propagee_pour_le_mode_degrade():
    tr, _ = make(RuntimeError("réseau coupé"))
    with pytest.raises(RuntimeError):
        run(tr.translate(GLOSSES))


def test_cache_des_phrases_frequentes():
    tr, messages = make(reply(GOOD))
    first = run(tr.translate(GLOSSES))
    second = run(tr.translate(GLOSSES, ["Autre contexte."]))
    assert first == second
    assert len(messages.calls) == 1


def test_le_cache_est_borne():
    tr, messages = make(*[reply(GOOD)] * 4)
    tr._cache_size = 2
    for name in ("A", "B", "C"):
        run(tr.translate([g(name, 0.9)]))
    assert len(tr._cache) == 2
    run(tr.translate([g("A", 0.9)]))  # A a été évincé : nouvel appel
    assert len(messages.calls) == 4


def test_aucune_glose():
    tr, _ = make()
    with pytest.raises(TranslationError):
        run(tr.translate([]))
