import json

import numpy as np
import pytest

from sikia_ml.augment import AugmentConfig, augment
from sikia_ml.data import (
    UNKNOWN_SIGNER,
    Sample,
    load_dir,
    load_recording,
    make_synthetic,
    split_by_signer,
)
from sikia_ml.layout import LEFT_HAND, VALUES_PER_FRAME


def write_recording(path, label="BONJOUR", signer="gad", n_rest=5, n_sign=20):
    """Fichier au format exporté par l'onglet Contribuer (web/src/lib/recording.ts)."""
    rng = np.random.default_rng(0)
    frames = []
    for i in range(n_rest + n_sign + n_rest):
        in_sign = n_rest <= i < n_rest + n_sign
        q = np.zeros(VALUES_PER_FRAME, dtype=int)
        if in_sign:
            q[: 63] = rng.integers(-4000, 4000, 63)
        frames.append({"t": i * 33, "flags": [1, int(in_sign), 0, 1], "q": q.tolist()})
    doc = {
        "version": 1, "label": label, "signer": signer, "createdAt": "2026-11-21T10:00:00Z",
        "layout": {"valuesPerFrame": VALUES_PER_FRAME, "quantScale": 4096, "segments": {}},
        "frames": frames,
    }
    path.write_text(json.dumps(doc), encoding="utf-8")


def test_un_enregistrement_est_recadre_sur_les_images_avec_une_main(tmp_path):
    write_recording(tmp_path / "a.json", n_rest=5, n_sign=20)
    s = load_recording(tmp_path / "a.json")
    assert (s.label, s.signer) == ("BONJOUR", "gad")
    assert s.window.shape == (20, 273)  # les 10 images de repos ont disparu
    assert np.abs(s.window[:, LEFT_HAND]).max() <= 4000 / 4096 + 1e-6  # dé-quantifié


def test_un_enregistrement_trop_court_est_ignore(tmp_path):
    write_recording(tmp_path / "a.json", n_sign=3)
    assert load_recording(tmp_path / "a.json") is None


def test_signeur_absent_devient_inconnu(tmp_path):
    write_recording(tmp_path / "a.json", signer="")
    assert load_recording(tmp_path / "a.json").signer == UNKNOWN_SIGNER


def test_load_dir_parcourt_les_sous_dossiers(tmp_path):
    (tmp_path / "x").mkdir()
    write_recording(tmp_path / "a.json")
    write_recording(tmp_path / "x" / "b.json", label="MERCI")
    assert sorted(s.label for s in load_dir(tmp_path)) == ["BONJOUR", "MERCI"]


def test_le_decoupage_ne_melange_jamais_un_signeur():
    samples = make_synthetic(n_classes=3, n_signers=8, reps=2)
    train, val, strict = split_by_signer(samples, 0.25, seed=3)
    assert strict
    assert {s.signer for s in train}.isdisjoint({s.signer for s in val})
    assert len(train) + len(val) == len(samples) and val


def test_sans_signeurs_identifies_le_decoupage_est_signale_optimiste():
    w = np.ones((10, 273), dtype=np.float32)
    samples = [Sample("A", UNKNOWN_SIGNER, w) for _ in range(10)]
    _, val, strict = split_by_signer(samples)
    assert not strict and val


def test_donnees_synthetiques_reproductibles():
    a = make_synthetic(n_classes=2, n_signers=2, reps=1, seed=5)
    b = make_synthetic(n_classes=2, n_signers=2, reps=1, seed=5)
    assert all(np.array_equal(x.window, y.window) for x, y in zip(a, b))
    assert len({s.label for s in a}) == 2


class TestAugment:
    def window(self):
        w = np.zeros((30, 273), dtype=np.float32)
        w[:, LEFT_HAND] = np.random.default_rng(0).normal(size=(30, 63))
        return w

    def test_les_points_absents_le_restent(self):
        out = augment(self.window(), np.random.default_rng(1), AugmentConfig(p_mirror=0.0, point_dropout=0.0))
        assert not out[:, 63:126].any()  # main droite absente avant, absente après

    def test_le_miroir_deplace_la_main_gauche_a_droite(self):
        cfg = AugmentConfig(p_mirror=1.0, max_rotation_deg=0, scale_range=(1, 1), speed_range=(1, 1),
                            point_dropout=0.0, noise_std=0.0)
        out = augment(self.window(), np.random.default_rng(1), cfg)
        assert not out[:, LEFT_HAND].any() and out[:, 63:126].any()

    def test_la_vitesse_change_la_duree(self):
        cfg = AugmentConfig(p_mirror=0.0, speed_range=(2.0, 2.0), point_dropout=0.0)
        out = augment(self.window(), np.random.default_rng(1), cfg)
        assert len(out) == 15

    def test_reproductible(self):
        a = augment(self.window(), np.random.default_rng(7))
        b = augment(self.window(), np.random.default_rng(7))
        assert np.array_equal(a, b)

    @pytest.mark.parametrize("seed", range(5))
    def test_la_sortie_reste_finie(self, seed):
        assert np.isfinite(augment(self.window(), np.random.default_rng(seed))).all()
