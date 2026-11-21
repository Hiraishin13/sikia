"""Augmentations d'un signe (n, 273). Appliquées à l'entraînement seulement."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from app.preprocess import resample_time

from .layout import mirror


@dataclass
class AugmentConfig:
    p_mirror: float = 0.5  # signeurs gauchers
    max_rotation_deg: float = 10.0
    scale_range: tuple[float, float] = (0.9, 1.1)
    speed_range: tuple[float, float] = (0.8, 1.2)
    # Robustesse aux proportions d'image inconnues (jeu ISLR) ou différentes d'une caméra à l'autre.
    x_stretch_range: tuple[float, float] = (0.8, 1.25)
    point_dropout: float = 0.03  # occlusions : chaque point disparaît avec cette probabilité
    noise_std: float = 0.01


def _rotate_xy(window: np.ndarray, degrees: float) -> np.ndarray:
    a = np.deg2rad(degrees)
    c, s = np.cos(a), np.sin(a)
    out = window.copy()
    x, y = window[..., 0::3], window[..., 1::3]
    out[..., 0::3] = c * x - s * y
    out[..., 1::3] = s * x + c * y
    return out


def augment(window: np.ndarray, rng: np.random.Generator, cfg: AugmentConfig | None = None) -> np.ndarray:
    cfg = cfg or AugmentConfig()
    out = np.asarray(window, dtype=np.float32)  # les exemples ISLR sont stockés en float16

    if rng.random() < cfg.p_mirror:
        out = mirror(out)

    out = _rotate_xy(out, rng.uniform(-cfg.max_rotation_deg, cfg.max_rotation_deg))
    out = out * rng.uniform(*cfg.scale_range)
    out = out.copy()
    out[:, 0::3] *= rng.uniform(*cfg.x_stretch_range)

    speed = rng.uniform(*cfg.speed_range)
    n_new = max(4, round(len(out) / speed))
    if n_new != len(out):
        out = resample_time(out, n_new)

    present = out != 0  # les points absents (zéros) le restent : le bruit ne s'applique qu'aux autres
    out = out + rng.normal(0.0, cfg.noise_std, out.shape).astype(np.float32) * present

    if cfg.point_dropout > 0:
        drop = rng.random((len(out), out.shape[1] // 3)) < cfg.point_dropout
        out = out * ~np.repeat(drop, 3, axis=1)

    return out.astype(np.float32)
