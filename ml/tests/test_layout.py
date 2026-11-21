import re
from pathlib import Path

import numpy as np
from app.protocol import VALUES_PER_FRAME as API_VALUES

from sikia_ml import layout

TS = Path(__file__).parents[2] / "web" / "src" / "lib" / "landmarks.ts"


def ts_ints(name: str) -> list[int]:
    """Lit un tableau d'entiers du fichier TypeScript, commentaires `//` ignorés."""
    src = TS.read_text(encoding="utf-8")
    body = re.search(rf"{name}\s*=\s*\[(.*?)\]", src, re.DOTALL).group(1)
    body = re.sub(r"//[^\n]*", "", body)
    return [int(n) for n in re.findall(r"\d+", body)]


def test_le_format_python_est_identique_au_typescript():
    """Si l'app change la disposition des points, ce test casse avant que l'entraînement ne diverge."""
    assert tuple(ts_ints("POSE_INDICES")) == layout.POSE_INDICES
    assert tuple(ts_ints("FACE_INDICES")) == layout.FACE_INDICES
    assert int(re.search(r"HAND_POINTS\s*=\s*(\d+)", TS.read_text(encoding="utf-8")).group(1)) == layout.HAND_POINTS


def test_273_valeurs_partout():
    assert layout.VALUES_PER_FRAME == API_VALUES == 273


def test_paires_du_miroir_completes():
    assert layout.mirror_pairs_are_valid()


def test_le_miroir_est_une_involution():
    x = np.random.default_rng(0).normal(size=(10, 273)).astype(np.float32)
    assert np.allclose(layout.mirror(layout.mirror(x)), x)


def test_le_miroir_echange_les_mains_et_inverse_x():
    x = np.random.default_rng(1).normal(size=(5, 273)).astype(np.float32)
    m = layout.mirror(x)
    left, right = layout.LEFT_HAND, layout.RIGHT_HAND
    # la main gauche du miroir est la main droite d'origine, x inversé, y et z inchangés
    assert np.allclose(m[:, left][:, 0::3], -x[:, right][:, 0::3])
    assert np.allclose(m[:, left][:, 1::3], x[:, right][:, 1::3])
    assert np.allclose(m[:, left][:, 2::3], x[:, right][:, 2::3])


def test_le_nez_reste_au_centre_apres_miroir():
    x = np.random.default_rng(2).normal(size=(3, 273)).astype(np.float32)
    nose = slice(layout.POSE_OFFSET, layout.POSE_OFFSET + 3)
    m = layout.mirror(x)
    assert np.allclose(m[:, nose][:, 0], -x[:, nose][:, 0])
    assert np.allclose(m[:, nose][:, 1:], x[:, nose][:, 1:])
