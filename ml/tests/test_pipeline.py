"""De bout en bout : données synthétiques → entraînement → ONNX → serveur."""

import numpy as np
import torch
from app.onnx_recognizer import ONNXRecognizer
from app.preprocess import SEQ_LEN, prepare_window

from sikia_ml.data import make_synthetic
from sikia_ml.layout import VALUES_PER_FRAME
from sikia_ml.model import SignTransformer
from sikia_ml.train import train

SMALL = {"d_model": 64, "heads": 4, "layers": 2, "ff": 128, "dropout": 0.0}


def test_le_modele_ignore_le_contenu_du_remplissage():
    model = SignTransformer(5, SEQ_LEN, **SMALL).eval()
    x = torch.randn(2, SEQ_LEN, VALUES_PER_FRAME)
    mask = torch.zeros(2, SEQ_LEN)
    mask[:, :20] = 1
    garbage = x.clone()
    garbage[:, 20:] = 99.0
    with torch.no_grad():
        assert torch.allclose(model(x, mask), model(garbage, mask), atol=1e-5)


def test_chaine_complete(tmp_path):
    samples = make_synthetic(n_classes=6, n_signers=6, reps=6, seed=0)
    report = train(samples, tmp_path, epochs=14, batch_size=16, lr=2e-3, seed=0, model_kwargs=SMALL)

    assert report["signer_independent"] is True
    assert report["val_top1"] >= 0.7, report  # hasard = 1/6 : la chaîne apprend bel et bien
    assert report["onnx_max_diff"] < 1e-3  # ONNX Runtime ≈ PyTorch
    assert report["meets_mvp_targets"] in (True, False)

    # Le serveur charge ce dossier tel quel et rend les mêmes réponses que PyTorch.
    out_dir = tmp_path / report["version"]
    recognizer = ONNXRecognizer(out_dir)
    assert recognizer.version == report["version"]
    assert len(recognizer.labels) == 6

    sample = samples[0]
    candidates = recognizer.predict(sample.window)
    assert len(candidates) == 3
    assert candidates[0].confidence > candidates[1].confidence
    assert abs(sum(c.confidence for c in candidates) - 1.0) <= 1.0 + 1e-6

    # même prétraitement côté entraînement et côté serveur : mêmes entrées exactes
    x, mask = prepare_window(sample.window, recognizer.seq_len)
    assert x.shape == (SEQ_LEN, VALUES_PER_FRAME) and np.isclose(mask.sum(), min(len(sample.window), SEQ_LEN))
