import json

import numpy as np
import pytest

onnx = pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")
from onnx import TensorProto, helper, numpy_helper

from app.factory import build_recognizer
from app.onnx_recognizer import ModelError, ONNXRecognizer
from app.pipeline import StubRecognizer
from app.protocol import VALUES_PER_FRAME

LABELS = ["BONJOUR", "MERCI", "OUI", "NON"]


def tiny_model(directory, input_dim=VALUES_PER_FRAME):
    """logits = moyenne temporelle de x × W : suffisant pour tester le chargement et l'inférence."""
    rng = np.random.default_rng(0)
    w = rng.normal(size=(VALUES_PER_FRAME, len(LABELS))).astype(np.float32)
    graph = helper.make_graph(
        [
            helper.make_node("ReduceMean", ["x"], ["pooled"], axes=[1], keepdims=0),
            helper.make_node("MatMul", ["pooled", "w"], ["logits"]),
        ],
        "tiny",
        [
            helper.make_tensor_value_info("x", TensorProto.FLOAT, ["batch", "T", VALUES_PER_FRAME]),
            helper.make_tensor_value_info("mask", TensorProto.FLOAT, ["batch", "T"]),
        ],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", len(LABELS)])],
        [numpy_helper.from_array(w, "w")],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    directory.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(directory / "model.onnx"))
    (directory / "labels.json").write_text(
        json.dumps({"version": "vtest", "labels": LABELS, "seq_len": 64, "input_dim": input_dim}),
        encoding="utf-8",
    )
    return w


def test_predict_renvoie_les_3_meilleurs_avec_des_probabilites(tmp_path):
    w = tiny_model(tmp_path / "m")
    rec = ONNXRecognizer(tmp_path / "m")
    window = np.random.default_rng(1).normal(size=(30, VALUES_PER_FRAME)).astype(np.float32)
    out = rec.predict(window)

    assert len(out) == 3
    assert [c.confidence for c in out] == sorted((c.confidence for c in out), reverse=True)
    assert 0 < sum(c.confidence for c in out) <= 1.0 + 1e-6
    # la première classe est bien celle de plus grand logit : moyenne sur les images réelles puis padding de zéros
    padded_mean = window.sum(0) / 64
    assert out[0].gloss == LABELS[int(np.argmax(padded_mean @ w))]


def test_input_dim_incompatible_refuse_au_chargement(tmp_path):
    tiny_model(tmp_path / "m", input_dim=100)
    with pytest.raises(ModelError, match="valeurs par image"):
        ONNXRecognizer(tmp_path / "m")


def test_labels_manquants(tmp_path):
    (tmp_path / "m").mkdir()
    with pytest.raises(ModelError):
        ONNXRecognizer(tmp_path / "m")


def test_factory_sans_modele_donne_le_reconnaisseur_factice(monkeypatch):
    monkeypatch.delenv("SIKIA_MODEL_DIR", raising=False)
    assert isinstance(build_recognizer(), StubRecognizer)


def test_factory_avec_modele(monkeypatch, tmp_path):
    tiny_model(tmp_path / "m")
    monkeypatch.setenv("SIKIA_MODEL_DIR", str(tmp_path / "m"))
    assert isinstance(build_recognizer(), ONNXRecognizer)


def test_factory_modele_illisible_refuse_de_demarrer(monkeypatch, tmp_path):
    monkeypatch.setenv("SIKIA_MODEL_DIR", str(tmp_path / "inexistant"))
    with pytest.raises(ModelError):
        build_recognizer()
