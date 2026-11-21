"""Export du modèle en ONNX + labels.json, au format lu par api/app/onnx_recognizer.py."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from .layout import VALUES_PER_FRAME
from .model import SignTransformer


def export_onnx(
    model: SignTransformer, out_dir: Path, labels: list[str], seq_len: int, version: str
) -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model.eval()
    # Le « fast path » de PyTorch en inférence utilise des opérateurs fusionnés non exportables.
    torch.backends.mha.set_fastpath_enabled(False)

    x = torch.zeros(1, seq_len, VALUES_PER_FRAME)
    mask = torch.ones(1, seq_len)
    kwargs = {
        "input_names": ["x", "mask"],
        "output_names": ["logits"],
        "dynamic_axes": {"x": {0: "batch"}, "mask": {0: "batch"}, "logits": {0: "batch"}},
        "opset_version": 17,
    }
    path = out_dir / "model.onnx"
    try:
        torch.onnx.export(model, (x, mask), str(path), dynamo=False, **kwargs)
    except TypeError:  # PyTorch < 2.5 : pas d'argument `dynamo`
        torch.onnx.export(model, (x, mask), str(path), **kwargs)

    (out_dir / "labels.json").write_text(
        json.dumps(
            {"version": version, "labels": labels, "seq_len": seq_len, "input_dim": VALUES_PER_FRAME},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def max_onnx_difference(
    model: SignTransformer, onnx_path: Path, x: np.ndarray, mask: np.ndarray
) -> float:
    """Écart maximal entre les logits PyTorch et ceux d'ONNX Runtime : doit être ~1e-4."""
    import onnxruntime as ort

    model.eval()
    with torch.no_grad():
        expected = model(torch.from_numpy(x), torch.from_numpy(mask)).numpy()
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    got = session.run(["logits"], {"x": x, "mask": mask})[0]
    return float(np.abs(expected - got).max())
