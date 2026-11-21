"""Briques interchangeables du pipeline : reconnaissance puis génération de texte.

Les implémentations ci-dessous sont des FACTICES qui permettent de brancher et tester le
client avant que le vrai modèle existe. Elles seront remplacées par :
  - Recognizer  → modèle ONNX entraîné dans ml/ (étape 2)
  - Translator  → appel à un LLM rapide, ex. Claude Haiku (étape 3)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class GlossCandidate:
    gloss: str
    confidence: float


@dataclass(frozen=True)
class Translation:
    text: str
    #: vrai si le traducteur a dû choisir entre plusieurs gloses plausibles
    uncertain: bool


class Recognizer(Protocol):
    def predict(self, window: np.ndarray) -> list[GlossCandidate]:
        """window : (n_images, 273). Renvoie les meilleurs candidats, du plus au moins probable."""
        ...


class Translator(Protocol):
    async def translate(self, glosses: list[list[GlossCandidate]]) -> Translation:
        """glosses : pour chaque signe de la phrase, ses candidats (le premier est le meilleur)."""
        ...


class StubRecognizer:
    """Choisit un signe d'un petit vocabulaire à partir du contenu de la fenêtre. Sans valeur réelle."""

    VOCAB = ("BONJOUR", "MERCI", "MOI", "DEMAIN", "MÉDECIN", "ALLER", "OUI", "NON")

    def predict(self, window: np.ndarray) -> list[GlossCandidate]:
        seed = int(abs(float(window.sum())) * 1000) % len(self.VOCAB)
        order = [(seed + i) % len(self.VOCAB) for i in range(3)]
        confidences = [0.82, 0.11, 0.04]
        return [GlossCandidate(self.VOCAB[i], c) for i, c in zip(order, confidences)]


class StubTranslator:
    """Assemble les gloses en une phrase minimale. Remplacé par un LLM à l'étape 3."""

    UNCERTAIN_BELOW = 0.6

    async def translate(self, glosses: list[list[GlossCandidate]]) -> Translation:
        words = [cands[0].gloss.lower() for cands in glosses if cands]
        text = " ".join(words)
        text = (text[:1].upper() + text[1:] + ".") if text else ""
        uncertain = any(cands and cands[0].confidence < self.UNCERTAIN_BELOW for cands in glosses)
        return Translation(text=text, uncertain=uncertain)
