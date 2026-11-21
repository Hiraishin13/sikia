"""Entraînement : python -m sikia_ml.train --data DOSSIER_D_ENREGISTREMENTS  (ou --synthetic pour tester la chaîne)."""

from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from app.preprocess import SEQ_LEN
from torch import nn
from torch.utils.data import DataLoader

from .data import Sample, SignDataset, load_dir, make_synthetic, split_by_signer
from .export import export_onnx, max_onnx_difference
from .model import SignTransformer, count_parameters

log = logging.getLogger("sikia_ml")

# Objectifs du MVP (docs/architecture.md) sur des signeurs jamais vus.
TARGET_TOP1 = 0.80
TARGET_TOP5 = 0.95


def evaluate(model: nn.Module, loader: DataLoader, n_classes: int, device: str) -> dict:
    model.eval()
    top1 = top5 = total = 0
    correct = Counter()
    seen = Counter()
    k = min(5, n_classes)
    with torch.no_grad():
        for x, mask, y in loader:
            x, mask, y = x.to(device), mask.to(device), y.to(device)
            logits = model(x, mask)
            best = logits.topk(k, dim=1).indices
            hit1 = best[:, 0] == y
            top1 += int(hit1.sum())
            top5 += int((best == y[:, None]).any(1).sum())
            total += len(y)
            for label, ok in zip(y.tolist(), hit1.tolist()):
                seen[label] += 1
                correct[label] += int(ok)
    per_class = {c: correct[c] / seen[c] for c in seen}
    return {"top1": top1 / total, "top5": top5 / total, "n": total, "per_class": per_class}


def train(
    samples: list[Sample],
    out_root: Path,
    epochs: int = 40,
    batch_size: int = 32,
    lr: float = 5e-4,
    seed: int = 0,
    val_frac: float = 0.25,
    model_kwargs: dict | None = None,
    source: str = "enregistrements",
) -> dict:
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    labels = sorted({s.label for s in samples})
    train_set, val_set, strict = split_by_signer(samples, val_frac, seed)
    missing = set(labels) - {s.label for s in train_set}
    if missing:
        log.warning("signes absents de l'entraînement (donc jamais appris) : %s", sorted(missing))

    train_dl = DataLoader(SignDataset(train_set, labels, True, seed), batch_size, shuffle=True, drop_last=len(train_set) > batch_size)
    val_dl = DataLoader(SignDataset(val_set, labels, False), batch_size)

    model = SignTransformer(len(labels), SEQ_LEN, **(model_kwargs or {})).to(device)
    log.info(
        "%d signes, %d exemples (%d train / %d val), %.1f M paramètres, appareil %s",
        len(labels), len(samples), len(train_set), len(val_set), count_parameters(model) / 1e6, device,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.05)
    steps = epochs * max(1, len(train_dl))
    schedule = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=lr, total_steps=steps, pct_start=0.15)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    best, best_state = {"top1": -1.0}, None
    for epoch in range(1, epochs + 1):
        model.train()
        running = 0.0
        for x, mask, y in train_dl:
            x, mask, y = x.to(device), mask.to(device), y.to(device)
            optimizer.zero_grad()
            loss = loss_fn(model(x, mask), y)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            running += loss.item() * len(y)
        metrics = evaluate(model, val_dl, len(labels), device)
        if metrics["top1"] > best["top1"]:
            best = {**metrics, "epoch": epoch}
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        if epoch == 1 or epoch % 5 == 0 or epoch == epochs:
            log.info(
                "époque %3d  perte %.3f  val top-1 %.1f %%  top-5 %.1f %%",
                epoch, running / len(train_set), metrics["top1"] * 100, metrics["top5"] * 100,
            )

    model.load_state_dict(best_state)
    model.cpu()
    version = "v" + time.strftime("%Y%m%d-%H%M%S")
    out_dir = Path(out_root) / version
    onnx_path = export_onnx(model, out_dir, labels, SEQ_LEN, version)

    xb, mb, _ = next(iter(DataLoader(SignDataset(val_set, labels, False), batch_size=min(8, len(val_set)))))
    diff = max_onnx_difference(model, onnx_path, xb.numpy(), mb.numpy())

    worst = sorted(best["per_class"].items(), key=lambda kv: kv[1])[:10]
    report = {
        "version": version,
        "source": source,
        "signer_independent": strict,
        "n_signs": len(labels),
        "n_train": len(train_set),
        "n_val": len(val_set),
        "val_top1": best["top1"],
        "val_top5": best["top5"],
        "best_epoch": best["epoch"],
        "onnx_max_diff": diff,
        "meets_mvp_targets": strict and best["top1"] >= TARGET_TOP1 and best["top5"] >= TARGET_TOP5,
        "per_sign_accuracy": {labels[c]: round(a, 3) for c, a in best["per_class"].items()},
        "weakest_signs": [(labels[c], round(a, 3)) for c, a in worst],
    }
    (out_dir / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--data", type=Path, help="dossier de fichiers .json exportés par l'app (onglet Contribuer)")
    src.add_argument("--islr", type=Path, help="dossier du jeu Google ISLR (Kaggle asl-signs) : train.csv + parquet")
    src.add_argument("--synthetic", action="store_true", help="signes FICTIFS : test de la chaîne uniquement")
    p.add_argument("--out", type=Path, default=Path("runs"))
    p.add_argument("--islr-max-per-sign", type=int, default=100, help="exemples par signe (le jeu complet pèse des Go)")
    p.add_argument("--islr-limit", type=int, default=None, help="nombre total maximal d'exemples (essais rapides)")
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=5e-4)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if args.synthetic:
        samples, source = make_synthetic(seed=args.seed), "SYNTHÉTIQUE (aucune valeur réelle)"
    elif args.islr:
        from .islr import load_islr

        samples = load_islr(args.islr, args.islr_max_per_sign, args.islr_limit, seed=args.seed)
        source = f"Google ISLR (ASL) : {args.islr}"
    else:
        samples, source = load_dir(args.data), str(args.data)
    if len(samples) < 20 or len({s.label for s in samples}) < 2:
        raise SystemExit(f"Pas assez de données ({len(samples)} exemples) : il faut au moins 2 signes et ~20 exemples.")

    report = train(samples, args.out, args.epochs, args.batch_size, args.lr, args.seed, source=source)
    print(json.dumps({k: v for k, v in report.items() if k != "per_sign_accuracy"}, ensure_ascii=False, indent=2))
    print(f"\nModèle prêt : {args.out / report['version']}")
    print(f"Pour le servir : SIKIA_MODEL_DIR={args.out / report['version']}")
    if not report["signer_independent"]:
        print("ATTENTION : score optimiste (moins de 2 signeurs identifiés).")
    if args.synthetic:
        print("ATTENTION : données synthétiques. Ce modèle ne reconnaît aucun vrai signe.")


if __name__ == "__main__":
    main()
