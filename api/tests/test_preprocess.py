import numpy as np
import pytest

from app.preprocess import SEQ_LEN, crop_to_hands, prepare_window, resample_time


def ramp(n: int, dim: int = 273) -> np.ndarray:
    return np.tile(np.arange(n, dtype=np.float32)[:, None], (1, dim))


def test_un_signe_court_est_complete_par_du_vide():
    x, mask = prepare_window(ramp(20))
    assert x.shape == (SEQ_LEN, 273) and mask.shape == (SEQ_LEN,)
    assert mask[:20].all() and not mask[20:].any()
    assert not x[20:].any()
    assert np.array_equal(x[:20], ramp(20))  # la vitesse du signeur est conservee


def test_un_signe_long_est_comprime_dans_le_temps():
    x, mask = prepare_window(ramp(200))
    assert mask.all()
    assert x[0, 0] == 0 and x[-1, 0] == pytest.approx(199)  # debut et fin conserves
    assert np.all(np.diff(x[:, 0]) > 0)  # toujours monotone


def test_fenetre_vide_refusee():
    with pytest.raises(ValueError):
        prepare_window(np.zeros((0, 273), dtype=np.float32))


def test_resample_interpole_lineairement():
    out = resample_time(ramp(3), 5)
    assert out[:, 0].tolist() == [0, 0.5, 1, 1.5, 2]


def test_une_seule_image_est_repetee():
    assert resample_time(ramp(1), 4).shape == (4, 273)


def test_crop_to_hands_garde_les_images_avec_une_main():
    data = ramp(6)
    valid = np.array([1, 1, 1, 1, 1, 0], dtype=bool)
    left = np.array([0, 0, 1, 0, 0, 1], dtype=bool)
    right = np.array([0, 0, 0, 1, 0, 1], dtype=bool)
    kept = crop_to_hands(data, valid, left, right)
    assert kept[:, 0].tolist() == [2, 3]  # image 5 : mains mais invalide ; image 0,1,4 : aucune main
