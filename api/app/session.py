"""Découpage du flux d'images en signes puis en phrases.

Version volontairement simple : un signe = une suite d'images où au moins une main est
détectée ; une courte pause sans main termine le signe, une longue pause termine la phrase.
Le détecteur d'activité fondé sur la vitesse des mains (étape 3) le remplacera, car en
signant en continu les mains ne quittent pas toujours le cadre entre deux signes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .pipeline import GlossCandidate, Recognizer
from .protocol import Frame


@dataclass
class SegmenterConfig:
    sign_pause_frames: int = 6  # ~0,2 s sans main : fin d'un signe
    sentence_pause_frames: int = 24  # ~0,8 s sans main : fin de phrase
    min_sign_frames: int = 8  # fenêtres plus courtes ignorées (parasites)


@dataclass
class SegmenterEvents:
    """Ce qu'un paquet a déclenché."""

    sign_added: bool = False
    sentence: list[list[GlossCandidate]] | None = None


@dataclass
class Segmenter:
    recognizer: Recognizer
    config: SegmenterConfig = field(default_factory=SegmenterConfig)

    _window: list[np.ndarray] = field(default_factory=list, init=False)
    _idle: int = field(default=0, init=False)
    _sentence: list[list[GlossCandidate]] = field(default_factory=list, init=False)

    @property
    def current_glosses(self) -> list[list[GlossCandidate]]:
        return list(self._sentence)

    def reset(self) -> None:
        self._window.clear()
        self._sentence.clear()
        self._idle = 0

    def push(self, frames: list[Frame]) -> SegmenterEvents:
        events = SegmenterEvents()
        cfg = self.config
        for frame in frames:
            if frame.hands_present:
                self._window.append(frame.data)
                self._idle = 0
                continue

            self._idle += 1
            if self._window and self._idle >= cfg.sign_pause_frames:
                if len(self._window) >= cfg.min_sign_frames:
                    candidates = self.recognizer.predict(np.stack(self._window))
                    self._sentence.append(candidates)
                    events.sign_added = True
                self._window.clear()

            if self._sentence and self._idle >= cfg.sentence_pause_frames:
                events.sentence = self._sentence
                self._sentence = []
        return events
