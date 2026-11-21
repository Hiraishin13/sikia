"""Reconnaissance de signes isolés avec un modèle ONNX entraîné dans ml/.

Dossier attendu (produit par `python -m sikia_ml.train`) :
    model.onnx    entrées x (B, T, 273) et mask (B, T) ; sortie logits (B, n_classes)
    labels.json   {"version", "labels": [...], "seq_len", "input_dim"}
Le modèle est chargé par numéro de version : changer de dossier suffit à déployer ou à revenir en arrière.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .pipeline import GlossCandidate
from .preprocess import prepare_window
from .protocol import VALUES_PER_FRAME

TOP_K = 3


class ModelError(RuntimeError):
    pass


class ONNXRecognizer:
    def __init__(self, model_dir: str | Path) -> None:
        import onnxruntime as ort  # dépendance optionnelle (extra « onnx »)

        model_dir = Path(model_dir)
        try:
            meta = json.loads((model_dir / "labels.json").read_text(encoding="utf-8"))
            self.labels: list[str] = list(meta["labels"])
            self.seq_len = int(meta["seq_len"])
            self.version = str(meta.get("version", model_dir.name))
            input_dim = int(meta["input_dim"])
        except (OSError, KeyError, ValueError) as e:
            raise ModelError(f"labels.json illisible dans {model_dir} : {e}") from e
        if input_dim != VALUES_PER_FRAME:
            raise ModelError(
                f"le modèle attend {input_dim} valeurs par image, le serveur en envoie {VALUES_PER_FRAME}"
            )
        self.session = ort.InferenceSession(
            str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"]
        )

    def predict(self, window: np.ndarray) -> list[GlossCandidate]:
        x, mask = prepare_window(window, self.seq_len)
        logits = self.session.run(["logits"], {"x": x[None], "mask": mask[None]})[0][0]
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        best = np.argsort(probs)[::-1][:TOP_K]
        return [GlossCandidate(self.labels[i], float(probs[i])) for i in best]
