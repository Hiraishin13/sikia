"""Disposition des 273 valeurs d'une image (voir docs/keypoints-format.md).

Miroir de web/src/lib/landmarks.ts : tests/test_layout.py vérifie qu'ils restent identiques.
"""

from __future__ import annotations

import numpy as np

HAND_POINTS = 21
POSE_INDICES = (0, 11, 12, 13, 14, 15, 16)  # nez, épaules G/D, coudes G/D, poignets G/D
FACE_INDICES = (
    # lèvres (contour extérieur)
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
    # sourcils
    70, 63, 105, 66, 107, 300, 293, 334, 296, 336,
    # yeux
    33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
)

LEFT_HAND = slice(0, HAND_POINTS * 3)
RIGHT_HAND = slice(HAND_POINTS * 3, HAND_POINTS * 6)
POSE_OFFSET = HAND_POINTS * 6
FACE_OFFSET = POSE_OFFSET + len(POSE_INDICES) * 3
VALUES_PER_FRAME = FACE_OFFSET + len(FACE_INDICES) * 3  # 273
N_POINTS = VALUES_PER_FRAME // 3  # 91

# Paires gauche/droite, en indices MediaPipe (visage) ou en positions dans POSE_INDICES (pose).
_POSE_PAIRS = ((1, 2), (3, 4), (5, 6))
_FACE_PAIRS = (
    (61, 291), (146, 375), (91, 321), (181, 405), (84, 314), (185, 409), (40, 270), (39, 269),
    (37, 267),  # lèvres
    (70, 300), (63, 293), (105, 334), (66, 296), (107, 336),  # sourcils
    (33, 263), (160, 387), (158, 385), (133, 362), (153, 373), (144, 380),  # yeux
)
_FACE_SELF = (17, 0)  # sur l'axe du visage : leur propre miroir


def _point_permutation() -> np.ndarray:
    perm = np.arange(N_POINTS)
    for i in range(HAND_POINTS):  # main gauche ↔ main droite, point à point
        perm[i], perm[HAND_POINTS + i] = HAND_POINTS + i, i
    pose0 = HAND_POINTS * 2
    for a, b in _POSE_PAIRS:
        perm[pose0 + a], perm[pose0 + b] = pose0 + b, pose0 + a
    face0 = pose0 + len(POSE_INDICES)
    pos = {mp: face0 + k for k, mp in enumerate(FACE_INDICES)}
    for a, b in _FACE_PAIRS:
        perm[pos[a]], perm[pos[b]] = pos[b], pos[a]
    return perm


def _build() -> tuple[np.ndarray, np.ndarray]:
    pp = _point_permutation()
    perm = (pp[:, None] * 3 + np.arange(3)[None, :]).reshape(-1)
    sign = np.ones(VALUES_PER_FRAME, dtype=np.float32)
    sign[0::3] = -1.0  # x change de signe ; y et z sont inchangés
    return perm, sign


MIRROR_PERM, MIRROR_SIGN = _build()


def mirror(window: np.ndarray) -> np.ndarray:
    """Symétrie gauche/droite (signeurs gauchers) : échange les côtés et inverse x."""
    return window[..., MIRROR_PERM] * MIRROR_SIGN


def face_mediapipe_ids() -> set[int]:
    return set(FACE_INDICES)


def mirror_pairs_are_valid() -> bool:
    """Chaque point du visage est soit sur l'axe, soit dans exactement une paire ; toutes les paires existent."""
    ids = face_mediapipe_ids()
    seen = [i for pair in _FACE_PAIRS for i in pair] + list(_FACE_SELF)
    return set(seen) == ids and len(seen) == len(set(seen))
