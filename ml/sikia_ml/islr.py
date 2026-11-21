"""Google Isolated Sign Language Recognition (Kaggle « asl-signs ») → format Sikia.

Jeu de données : 250 signes de la langue des signes AMÉRICAINE (ASL), ~94 000 séquences, déjà en points
MediaPipe. Il faut un compte Kaggle et accepter les règles de la compétition (vérifiez la licence sur
https://www.kaggle.com/competitions/asl-signs/data) :

    kaggle competitions download -c asl-signs        # ~40 Go

Contenu utilisé : train.csv (path, participant_id, sequence_id, sign) et les fichiers .parquet de points.
Chaque image compte 543 points rangés par type, dans cet ordre alphabétique :
visage 468 · main gauche 21 · pose 33 · main droite 21. Les points non détectés sont NaN.

Limites à connaître : les points viennent de MediaPipe Holistic (ancienne API) et non des modèles « Tasks »
de l'app : de légères différences de détection sont à prévoir. Le format d'image d'origine est inconnu, donc
l'hypothèse de proportions utilisée pour la normalisation est approximative ; l'entraînement compense en
étirant aléatoirement l'axe x (voir augment.py).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path

import numpy as np

from .data import MIN_SIGN_FRAMES, Sample
from .layout import (
    FACE_INDICES,
    FACE_OFFSET,
    LEFT_HAND,
    POSE_INDICES,
    POSE_OFFSET,
    RIGHT_HAND,
    VALUES_PER_FRAME,
)

log = logging.getLogger("sikia_ml")

POINTS_PER_FRAME = 543
_FACE = slice(0, 468)
_LEFT = slice(468, 489)
_POSE = slice(489, 522)
_RIGHT = slice(522, 543)
_LEFT_SHOULDER, _RIGHT_SHOULDER = 11, 12

#: Les vidéos sont tournées à la verticale ou à l'horizontale : on suppose des proportions carrées.
DEFAULT_ASPECT = 1.0


def convert_frames(points: np.ndarray, aspect: float = DEFAULT_ASPECT) -> np.ndarray:
    """(n, 543, 3) avec NaN → (n, 273) normalisé comme l'app (web/src/lib/landmarks.ts, normalizeFrame).

    Recentre sur le milieu des épaules et divise par leur largeur. Un point absent (NaN) vaut 0, comme
    dans l'app. Les images sans épaules visibles sont supprimées (l'app les marque invalides).
    """
    if points.ndim != 3 or points.shape[1:] != (POINTS_PER_FRAME, 3):
        raise ValueError(f"forme inattendue : {points.shape}, attendu (n, {POINTS_PER_FRAME}, 3)")
    points = points.astype(np.float32)
    pose = points[:, _POSE]
    ls, rs = pose[:, _LEFT_SHOULDER], pose[:, _RIGHT_SHOULDER]

    center = (ls + rs) / 2
    width = np.hypot((ls[:, 0] - rs[:, 0]) * aspect, ls[:, 1] - rs[:, 1])
    ok = np.isfinite(width) & (width > 1e-4) & np.isfinite(center).all(axis=1)
    if not ok.any():
        return np.zeros((0, VALUES_PER_FRAME), dtype=np.float32)

    points, center, width = points[ok], center[ok], width[ok]
    scale = np.array([aspect, 1.0, aspect], dtype=np.float32)

    def norm(block: np.ndarray) -> np.ndarray:
        out = (block - center[:, None, :]) * scale / width[:, None, None]
        return np.nan_to_num(out, nan=0.0).reshape(len(out), -1)

    frames = np.zeros((len(points), VALUES_PER_FRAME), dtype=np.float32)
    frames[:, LEFT_HAND] = norm(points[:, _LEFT])
    frames[:, RIGHT_HAND] = norm(points[:, _RIGHT])
    frames[:, POSE_OFFSET : FACE_OFFSET] = norm(points[:, _POSE][:, list(POSE_INDICES)])
    frames[:, FACE_OFFSET:] = norm(points[:, _FACE][:, list(FACE_INDICES)])
    return frames


def hands_present(points: np.ndarray) -> np.ndarray:
    """(n,) vrai si au moins une main est détectée (aucun NaN sur ses 21 points)."""
    left = np.isfinite(points[:, _LEFT]).all(axis=(1, 2))
    right = np.isfinite(points[:, _RIGHT]).all(axis=(1, 2))
    return left | right


def convert_sequence(parquet_path: Path, aspect: float = DEFAULT_ASPECT) -> np.ndarray | None:
    """Un fichier .parquet de Kaggle → fenêtre de signe (n, 273), ou None si inexploitable."""
    import pandas as pd

    df = pd.read_parquet(parquet_path, columns=["x", "y", "z"])
    if len(df) == 0 or len(df) % POINTS_PER_FRAME:
        log.warning("%s ignoré : %d lignes, pas un multiple de %d", parquet_path, len(df), POINTS_PER_FRAME)
        return None
    points = df.to_numpy(dtype=np.float32).reshape(-1, POINTS_PER_FRAME, 3)
    present = hands_present(points)
    frames_all = convert_frames(points, aspect)
    # convert_frames retire les images sans épaules ; on aligne le masque des mains sur ce qui reste.
    pose = points[:, _POSE]
    ls, rs = pose[:, _LEFT_SHOULDER], pose[:, _RIGHT_SHOULDER]
    width = np.hypot((ls[:, 0] - rs[:, 0]) * aspect, ls[:, 1] - rs[:, 1])
    kept = np.isfinite(width) & (width > 1e-4) & np.isfinite(ls + rs).all(axis=1)
    window = frames_all[present[kept]]
    return window if len(window) >= MIN_SIGN_FRAMES else None


def load_islr(
    root: Path,
    max_per_sign: int | None = None,
    limit: int | None = None,
    aspect: float = DEFAULT_ASPECT,
    seed: int = 0,
) -> list[Sample]:
    """Charge train.csv + parquet. `max_per_sign` et `limit` bornent la mémoire (le jeu complet pèse des Go)."""
    import pandas as pd

    root = Path(root)
    meta = pd.read_csv(root / "train.csv")
    rng = np.random.default_rng(seed)

    rows_by_sign: dict[str, list] = defaultdict(list)
    for row in meta.itertuples(index=False):
        rows_by_sign[str(row.sign)].append(row)

    samples: list[Sample] = []
    for sign, rows in sorted(rows_by_sign.items()):
        if max_per_sign and len(rows) > max_per_sign:
            rows = [rows[i] for i in rng.choice(len(rows), max_per_sign, replace=False)]
        for row in rows:
            window = convert_sequence(root / row.path, aspect)
            if window is None:
                continue
            # float16 : la moitié de la mémoire, sans effet sur la précision (coordonnées de l'ordre de 1).
            samples.append(Sample(label=sign.upper(), signer=f"islr-{row.participant_id}", window=window.astype(np.float16)))
            if limit and len(samples) >= limit:
                return samples
        log.info("%s : %d exemples chargés", sign, sum(1 for s in samples if s.label == sign.upper()))
    return samples
