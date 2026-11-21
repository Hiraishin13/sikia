"""Chargement des enregistrements Sikia, découpage par signeur, jeu synthétique de test."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from app.preprocess import SEQ_LEN, crop_to_hands, prepare_window
from torch.utils.data import Dataset

from .augment import AugmentConfig, augment
from .layout import HAND_POINTS, POSE_OFFSET, VALUES_PER_FRAME

log = logging.getLogger("sikia_ml")

MIN_SIGN_FRAMES = 8  # même seuil que le serveur (SegmenterConfig.min_sign_frames)
UNKNOWN_SIGNER = "inconnu"


@dataclass
class Sample:
    label: str
    signer: str
    window: np.ndarray  # (n, 273) : uniquement les images où une main est détectée


def load_recording(path: Path) -> Sample | None:
    """Lit un fichier exporté par l'onglet « Contribuer » de l'app. None si inexploitable."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    layout = doc["layout"]
    if layout["valuesPerFrame"] != VALUES_PER_FRAME:
        raise ValueError(f"{path} : {layout['valuesPerFrame']} valeurs par image, attendu {VALUES_PER_FRAME}")
    frames = doc["frames"]
    if not frames:
        return None
    scale = float(layout["quantScale"])
    data = np.array([f["q"] for f in frames], dtype=np.float32) / scale
    flags = np.array([f["flags"] for f in frames], dtype=bool)  # valid, gauche, droite, visage
    window = crop_to_hands(data, flags[:, 0], flags[:, 1], flags[:, 2])
    if len(window) < MIN_SIGN_FRAMES:
        log.warning("%s ignoré : seulement %d images avec une main", path, len(window))
        return None
    return Sample(label=doc["label"].strip().upper(), signer=doc.get("signer") or UNKNOWN_SIGNER, window=window)


def load_dir(root: Path) -> list[Sample]:
    samples = []
    for path in sorted(Path(root).rglob("*.json")):
        sample = load_recording(path)
        if sample is not None:
            samples.append(sample)
    return samples


def split_by_signer(
    samples: list[Sample], val_frac: float = 0.25, seed: int = 0
) -> tuple[list[Sample], list[Sample], bool]:
    """Aucun signeur n'apparaît à la fois en entraînement et en validation, sinon les scores sont gonflés.

    Renvoie (entraînement, validation, strict). strict est faux quand il y a moins de 2 signeurs
    identifiés : on retombe alors sur un tirage au hasard, dont le score est OPTIMISTE.
    """
    by_signer: dict[str, list[Sample]] = defaultdict(list)
    for s in samples:
        by_signer[s.signer].append(s)
    known = [k for k in by_signer if k != UNKNOWN_SIGNER]
    rng = np.random.default_rng(seed)

    if len(known) >= 2 and UNKNOWN_SIGNER not in by_signer:
        order = list(known)
        rng.shuffle(order)
        n_val = min(len(order) - 1, max(1, round(len(order) * val_frac)))
        val_signers = set(order[:n_val])
        train = [s for s in samples if s.signer not in val_signers]
        val = [s for s in samples if s.signer in val_signers]
        return train, val, True

    log.warning(
        "moins de 2 signeurs identifiés : découpage au hasard, score OPTIMISTE. "
        "Renseignez un pseudo dans l'onglet Contribuer pour un vrai découpage par signeur."
    )
    idx = rng.permutation(len(samples))
    n_val = max(1, round(len(samples) * val_frac))
    val = [samples[i] for i in idx[:n_val]]
    train = [samples[i] for i in idx[n_val:]]
    return train, val, False


def make_synthetic(
    n_classes: int = 12, n_signers: int = 6, reps: int = 8, seed: int = 0
) -> list[Sample]:
    """Signes FICTIFS : chaque classe a sa forme de main et sa trajectoire, chaque signeur sa vitesse et
    son amplitude. Sert uniquement à vérifier que la chaîne (données → modèle → ONNX → serveur) fonctionne.
    Un score obtenu là-dessus ne dit RIEN de la reconnaissance de vrais signes.
    """
    rng = np.random.default_rng(seed)
    shapes = rng.normal(0, 0.25, (n_classes, HAND_POINTS, 3))
    centers = rng.uniform(-1.2, 1.2, (n_classes, 3))
    freqs = rng.uniform(1.0, 3.0, (n_classes, 3))
    phases = rng.uniform(0, 2 * np.pi, (n_classes, 3))
    both_hands = rng.random(n_classes) < 0.4

    samples: list[Sample] = []
    for signer in range(n_signers):
        speed = rng.uniform(0.8, 1.25)
        amp = rng.uniform(0.8, 1.2)
        offset = rng.normal(0, 0.08, 3)
        for c in range(n_classes):
            for _ in range(reps):
                n = int(rng.integers(22, 44) / speed)
                t = np.linspace(0, 1, n)[:, None]
                path = centers[c] + amp * 0.6 * np.sin(freqs[c] * np.pi * t + phases[c]) + offset
                frames = np.zeros((n, VALUES_PER_FRAME), dtype=np.float32)
                right = path[:, None, :] + shapes[c][None]
                frames[:, HAND_POINTS * 3 : HAND_POINTS * 6] = right.reshape(n, -1)
                if both_hands[c]:
                    left = np.stack([-path[:, 0], path[:, 1], path[:, 2]], 1)[:, None, :] + shapes[c][None]
                    frames[:, : HAND_POINTS * 3] = left.reshape(n, -1)
                frames[:, POSE_OFFSET + 3 : POSE_OFFSET + 9] = [-0.5, 0, 0, 0.5, 0, 0]  # épaules
                frames += rng.normal(0, 0.02, frames.shape).astype(np.float32) * (frames != 0)
                samples.append(Sample(label=f"SIGNE_{c:02d}", signer=f"synth{signer}", window=frames))
    return samples


class SignDataset(Dataset):
    """Un signe → (x (64, 273), mask (64,), classe)."""

    def __init__(
        self, samples: list[Sample], labels: list[str], train: bool, seed: int = 0, cfg: AugmentConfig | None = None
    ) -> None:
        self.samples = samples
        self.index = {lab: i for i, lab in enumerate(labels)}
        self.train = train
        self.cfg = cfg
        self.rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, i: int):
        s = self.samples[i]
        window = augment(s.window, self.rng, self.cfg) if self.train else s.window
        x, mask = prepare_window(window, SEQ_LEN)
        return torch.from_numpy(x), torch.from_numpy(mask), self.index[s.label]
