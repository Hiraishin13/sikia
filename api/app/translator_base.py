"""Logique commune aux traducteurs « gloses → phrase française » fondés sur un LLM.

Le fournisseur (Claude, Gemini…) n'apporte que l'appel réseau (`_complete`). Tout le reste est partagé,
pour que changer de fournisseur ne change ni le prompt, ni le cache, ni les garde-fous :
  1. le prompt interdit d'ajouter une information absente des gloses ;
  2. le modèle déclare quelles gloses il a exprimées, et le serveur vérifie que toutes celles de forte
     confiance y figurent (sinon la phrase est marquée incertaine) ;
  3. toute erreur (réseau, refus, JSON invalide, délai) lève une exception : le serveur bascule alors
     en mode dégradé et l'app affiche les gloses brutes.
"""

from __future__ import annotations

import json
import logging
import os
from collections import OrderedDict
from collections.abc import Sequence

from .pipeline import GlossCandidate, Translation

log = logging.getLogger("sikia.llm")

#: Délai accordé au traducteur avant de basculer en mode dégradé (gloses brutes). 2 s selon l'architecture ;
#: l'offre gratuite de Gemini est trop irrégulière pour cela (voir README) : SIKIA_TRANSLATE_TIMEOUT_S=4.
DEFAULT_TRANSLATE_TIMEOUT_S = 2.0


def translate_timeout_s() -> float:
    try:
        return float(os.environ.get("SIKIA_TRANSLATE_TIMEOUT_S", DEFAULT_TRANSLATE_TIMEOUT_S))
    except ValueError:
        return DEFAULT_TRANSLATE_TIMEOUT_S


def request_timeout_s() -> float:
    """Délai de l'appel réseau : un peu sous celui du serveur, et sans nouvelle tentative
    (un retry dépasserait de toute façon le budget, et l'utilisateur verrait les gloses brutes)."""
    return max(0.5, translate_timeout_s() - 0.2)

#: Une glose au moins aussi sûre doit apparaître dans la phrase.
STRONG_CONFIDENCE = 0.8

#: Une glose moins sûre rend la phrase « incertaine », quoi qu'en dise le modèle.
UNCERTAIN_BELOW = 0.6

SYSTEM_PROMPT = """\
Tu traduis des suites de gloses de langue des signes française (LSF) en une phrase française naturelle.

Une glose est le nom d'un signe, en majuscules. L'ordre des signes suit la grammaire de la LSF (par \
exemple le temps vient en premier, le verbe à la fin), pas celle du français. Chaque glose arrive avec \
une confiance entre 0 et 1 et parfois des alternatives plausibles.

Règles :
- Écris une seule phrase correcte, courte, à l'oral courant, avec ponctuation et majuscule.
- N'ajoute AUCUNE information absente des gloses : pas de lieu, de personne, de quantité ni de détail \
inventés. Tu peux seulement ajouter les mots grammaticaux nécessaires (articles, prépositions, \
conjugaison, pronoms).
- Utilise les phrases précédentes seulement pour lever une ambiguïté (qui parle, de quoi on parle).
- Si une glose est peu sûre, choisis l'alternative qui rend la phrase cohérente, et mets "uncertain" à true.
- Si les gloses ne forment pas une phrase compréhensible, donne la meilleure lecture littérale et mets \
"uncertain" à true.
- "covered" liste les numéros des gloses (celles de la liste, pas les alternatives) que ta phrase exprime.

Exemples :
Gloses : 1. MOI (0.9) 2. DEMAIN (0.9) 3. MÉDECIN (0.8) 4. ALLER (0.9)
→ {"text": "Demain, je vais chez le médecin.", "uncertain": false, "covered": [1, 2, 3, 4]}

Gloses : 1. BONJOUR (0.95) 2. MOI (0.9) 3. PRÉNOM-GAD (0.85)
→ {"text": "Bonjour, je m'appelle Gad.", "uncertain": false, "covered": [1, 2, 3]}

Gloses : 1. MANGER (0.9) 2. TOI (0.4, alternatives : MOI 0.35) 3. QUOI (0.8)
→ {"text": "Tu manges quoi ?", "uncertain": true, "covered": [1, 2, 3]}
"""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "uncertain": {"type": "boolean"},
        "covered": {"type": "array", "items": {"type": "integer"}},
    },
    "required": ["text", "uncertain", "covered"],
    "additionalProperties": False,
}


class TranslationError(RuntimeError):
    """Le LLM n'a pas produit de traduction exploitable."""


def render_prompt(glosses: list[list[GlossCandidate]], context: Sequence[str]) -> str:
    lines: list[str] = []
    if context:
        lines.append("Phrases précédentes :")
        lines += [f"- {c}" for c in context]
        lines.append("")
    lines.append("Gloses :")
    for i, cands in enumerate(glosses, start=1):
        best, *alts = cands
        line = f"{i}. {best.gloss} ({best.confidence:.2f})"
        if alts:
            line += " — alternatives : " + ", ".join(f"{a.gloss} {a.confidence:.2f}" for a in alts)
        lines.append(line)
    return "\n".join(lines)


def parse_translation(raw: str, glosses: list[list[GlossCandidate]]) -> Translation:
    """JSON du modèle → Translation, avec le garde-fou sur les gloses fortes."""
    try:
        data = json.loads(raw)
        text = data["text"].strip()
        uncertain = bool(data["uncertain"])
        covered = {int(i) for i in data["covered"]}
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        raise TranslationError(f"JSON invalide : {e}") from e
    if not text:
        raise TranslationError("phrase vide")

    strong = {i for i, cands in enumerate(glosses, start=1) if cands[0].confidence >= STRONG_CONFIDENCE}
    if not strong <= covered:
        log.warning("gloses fortes absentes de la phrase : %s", sorted(strong - covered))
        uncertain = True
    # Règle déterministe, indépendante du modèle : un signe peu sûr rend la phrase incertaine.
    if any(cands[0].confidence < UNCERTAIN_BELOW for cands in glosses):
        uncertain = True
    return Translation(text=text, uncertain=uncertain)


class CachedTranslator:
    """Squelette : cache des phrases fréquentes + appel `_complete` du fournisseur."""

    model: str

    def __init__(self, cache_size: int = 256) -> None:
        self._cache: OrderedDict[tuple, Translation] = OrderedDict()
        self._cache_size = cache_size

    async def _complete(self, user_prompt: str) -> str:
        """Envoie le prompt au fournisseur et renvoie le JSON brut. Lève une exception en cas d'échec."""
        raise NotImplementedError

    async def translate(
        self, glosses: list[list[GlossCandidate]], context: Sequence[str] = ()
    ) -> Translation:
        glosses = [c for c in glosses if c]
        if not glosses:
            raise TranslationError("aucune glose à traduire")

        # Cache des phrases fréquentes. La clé ignore le contexte : pour un vocabulaire fermé, le même
        # enchaînement de gloses donne la même phrase, et un hit évite un appel (facturé ou limité).
        key = tuple(tuple((g.gloss, round(g.confidence, 1)) for g in cands) for cands in glosses)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]

        result = parse_translation(await self._complete(render_prompt(glosses, context)), glosses)
        self._cache[key] = result
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return result
