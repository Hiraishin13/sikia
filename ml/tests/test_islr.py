"""Convertisseur Google ISLR → format Sikia, testé sur des fichiers au format Kaggle fabriqués ici."""

import numpy as np
import pandas as pd
import pytest

from sikia_ml.islr import (
    POINTS_PER_FRAME,
    convert_frames,
    convert_sequence,
    hands_present,
    load_islr,
)
from sikia_ml.layout import LEFT_HAND, POSE_OFFSET, RIGHT_HAND, VALUES_PER_FRAME

# Positions dans un tableau (n, 543, 3) : visage 0-467, main gauche 468-488, pose 489-521, main droite 522-542
LEFT0, POSE0, RIGHT0 = 468, 489, 522


def frames(n=3, right_hand_at=None):
    """n images où seules les épaules (pose 11 et 12) sont détectées, plus éventuellement la main droite."""
    p = np.full((n, POINTS_PER_FRAME, 3), np.nan, dtype=np.float32)
    p[:, POSE0 + 11] = (0.4, 0.5, 0.0)
    p[:, POSE0 + 12] = (0.6, 0.5, 0.0)
    if right_hand_at is not None:
        p[:, RIGHT0 : RIGHT0 + 21] = right_hand_at
    return p


def test_meme_normalisation_que_l_app():
    # Même cas que web/src/lib/landmarks.test.ts : épaules de largeur 0,2 ; main décalée de 0,2 → 1 largeur
    out = convert_frames(frames(right_hand_at=(0.7, 0.5, 0.0)))
    assert out.shape == (3, VALUES_PER_FRAME)
    assert out[0, RIGHT_HAND][0] == pytest.approx(1.0)
    assert out[0, RIGHT_HAND][1] == pytest.approx(0.0)


def test_les_points_absents_valent_zero():
    out = convert_frames(frames())  # aucune main
    assert not out[:, LEFT_HAND].any() and not out[:, RIGHT_HAND].any()
    assert np.isfinite(out).all()


def test_les_epaules_sont_centrees_sur_l_origine():
    out = convert_frames(frames())
    ls = out[0, POSE_OFFSET + 3 : POSE_OFFSET + 6]  # 2e point de pose retenu : épaule gauche
    rs = out[0, POSE_OFFSET + 6 : POSE_OFFSET + 9]
    assert ls[0] == pytest.approx(-0.5) and rs[0] == pytest.approx(0.5)  # ±(largeur/2) / largeur


def test_les_images_sans_epaules_sont_supprimees():
    p = frames(n=4, right_hand_at=(0.7, 0.5, 0.0))
    p[1, POSE0 + 11] = np.nan
    assert len(convert_frames(p)) == 3


def test_independant_de_la_taille_de_la_personne():
    near = convert_frames(frames(right_hand_at=(0.7, 0.5, 0.0)))
    far_points = frames(right_hand_at=(0.6, 0.55, 0.0))
    far_points[:, POSE0 + 11] = (0.45, 0.5, 0.0)
    far_points[:, POSE0 + 12] = (0.55, 0.5, 0.0)
    far = convert_frames(far_points)
    assert far[0, RIGHT_HAND][0] == pytest.approx(near[0, RIGHT_HAND][0])


def test_forme_invalide():
    with pytest.raises(ValueError):
        convert_frames(np.zeros((3, 10, 3), dtype=np.float32))


def test_hands_present():
    p = frames(n=3)
    p[2, RIGHT0 : RIGHT0 + 21] = 0.5
    assert hands_present(p).tolist() == [False, False, True]


def write_parquet(path, points):
    """Écrit au format Kaggle : une ligne par point, rangées par image."""
    n = len(points)
    df = pd.DataFrame(
        {
            "frame": np.repeat(np.arange(n), POINTS_PER_FRAME),
            "x": points[:, :, 0].reshape(-1),
            "y": points[:, :, 1].reshape(-1),
            "z": points[:, :, 2].reshape(-1),
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path)


def sign_points(n_rest=4, n_sign=15):
    p = frames(n=n_rest + n_sign + n_rest)
    p[n_rest : n_rest + n_sign, RIGHT0 : RIGHT0 + 21] = (0.7, 0.5, 0.0)
    return p


def test_une_sequence_est_recadree_sur_les_images_avec_main(tmp_path):
    write_parquet(tmp_path / "a.parquet", sign_points())
    window = convert_sequence(tmp_path / "a.parquet")
    assert window.shape == (15, VALUES_PER_FRAME)


def test_une_sequence_trop_courte_est_ignoree(tmp_path):
    write_parquet(tmp_path / "a.parquet", sign_points(n_sign=3))
    assert convert_sequence(tmp_path / "a.parquet") is None


def test_un_fichier_mal_forme_est_ignore(tmp_path):
    pd.DataFrame({"x": [0.0] * 100, "y": [0.0] * 100, "z": [0.0] * 100}).to_parquet(tmp_path / "b.parquet")
    assert convert_sequence(tmp_path / "b.parquet") is None


def test_load_islr_lit_train_csv_et_borne_par_signe(tmp_path):
    rows = []
    for sign in ("hello", "thank you"):
        for i in range(5):
            rel = f"train_landmark_files/{i % 2}/{sign.replace(' ', '')}{i}.parquet"
            write_parquet(tmp_path / rel, sign_points())
            rows.append({"path": rel, "participant_id": i % 2, "sequence_id": i, "sign": sign})
    pd.DataFrame(rows).to_csv(tmp_path / "train.csv", index=False)

    samples = load_islr(tmp_path, max_per_sign=3)
    assert len(samples) == 6  # 3 par signe
    assert {s.label for s in samples} == {"HELLO", "THANK YOU"}
    assert {s.signer for s in samples} <= {"islr-0", "islr-1"}  # le signeur d'origine est conservé
    assert samples[0].window.dtype == np.float16  # mémoire divisée par deux
    assert len(load_islr(tmp_path, limit=2)) == 2
