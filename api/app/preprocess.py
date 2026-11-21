"""Mise en forme d'un signe avant le modèle.

Ce module est la SEULE définition de ce prétraitement : l'entraînement (ml/) l'importe, et le serveur
l'applique aux signes reçus. Deux copies qui divergent, c'est la cause n°1 de modèles excellents en
test et mauvais en production.
"""

from __future__ import annotations

import numpy as np

SEQ_LEN = 64  # images par signe fournies au modèle (~2 s à 30 i/s)


def crop_to_hands(
    data: np.ndarray, valid: np.ndarray, left: np.ndarray, right: np.ndarray
) -> np.ndarray:
    """Ne garde que les images où au moins une main est détectée (comme le découpage du serveur).

    data : (n, 273) ; valid/left/right : (n,) booléens. Sert à transformer un enregistrement complet
    (avec les moments de repos avant et après) en l'équivalent d'une fenêtre de signe.
    """
    return data[valid & (left | right)]


def resample_time(window: np.ndarray, n_out: int) -> np.ndarray:
    """Rééchantillonne la séquence à n_out images par interpolation linéaire."""
    n = len(window)
    if n == n_out:
        return window
    if n == 1:
        return np.repeat(window, n_out, axis=0)
    pos = np.linspace(0, n - 1, n_out)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, n - 1)
    frac = (pos - lo).astype(window.dtype)[:, None]
    return window[lo] * (1 - frac) + window[hi] * frac


def prepare_window(window: np.ndarray, seq_len: int = SEQ_LEN) -> tuple[np.ndarray, np.ndarray]:
    """(n, 273) → x (seq_len, 273) float32 et mask (seq_len,) float32 (1 = vraie image).

    Un signe court est complété par du vide (la vitesse reste celle du signeur) ; un signe plus long
    que seq_len est comprimé dans le temps.
    """
    window = np.asarray(window, dtype=np.float32)
    if window.ndim != 2 or len(window) == 0:
        raise ValueError("fenêtre vide ou mal formée")
    if len(window) > seq_len:
        window = resample_time(window, seq_len)
    n = len(window)
    x = np.zeros((seq_len, window.shape[1]), dtype=np.float32)
    mask = np.zeros(seq_len, dtype=np.float32)
    x[:n] = window
    mask[:n] = 1.0
    return x, mask
