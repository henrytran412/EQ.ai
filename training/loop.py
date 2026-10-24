"""Training loop shared by the face and voice classifiers.

AdamW with a lower learning rate for the pretrained backbone than for the new head,
linear warmup then cosine decay, mixed precision on GPU, an exponential moving
average (EMA) of the weights, and early stopping on validation macro F1.
"""

import csv
import json
import logging
import math
import random
import time
from pathlib import Path
from typing import Callable

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.optim.swa_utils import AveragedModel, get_ema_multi_avg_fn

from metrics import classification_metrics

log = logging.getLogger("train")


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def pick_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def soft_cross_entropy(logits: torch.Tensor, soft_targets: torch.Tensor) -> torch.Tensor:
    return torch.sum(-soft_targets * F.log_softmax(logits, dim=-1), dim=-1).mean()


@torch.no_grad()
def predict(model: nn.Module, loader, device: torch.device,
            tta: Callable[[torch.Tensor], torch.Tensor] | None = None) -> tuple[list[int], list[int]]:
    model.eval()
    y_true, y_pred = [], []
    for x, y in loader:
        x = x.to(device, non_blocking=True)
        with torch.autocast(device.type, enabled=device.type == "cuda"):
            logits = model(x).float()
            if tta is not None:
                logits = (logits.softmax(-1) + model(tta(x)).float().softmax(-1)) / 2
        y_pred += logits.argmax(-1).tolist()
        y_true += y.tolist()
    return y_true, y_pred


def fit(model: nn.Module, head: nn.Module, train_dl, val_dl, labels: list[str], args, device: torch.device,
        out_dir: Path, mix_fn: Callable | None = None, class_weights: torch.Tensor | None = None,
        tta: Callable | None = None) -> tuple[nn.Module, dict]:
    """Select raw or EMA weights by validation macro F1; never select using test data."""
    out_dir.mkdir(parents=True, exist_ok=True)
    head_ids = {id(p) for p in head.parameters()}
    backbone = [p for p in model.parameters() if p.requires_grad and id(p) not in head_ids]
    optimizer = torch.optim.AdamW([{"params": backbone, "lr": args.backbone_lr},
                                   {"params": list(head.parameters()), "lr": args.lr}],
                                  weight_decay=args.weight_decay)
    total = max(1, args.epochs * len(train_dl))
    warmup = min(len(train_dl), total // 10 + 1)
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda s: (s + 1) / warmup if s < warmup else 0.5 * (1 + math.cos(math.pi * (s - warmup) / max(1, total - warmup))))
    scaler = torch.amp.GradScaler(device.type, enabled=device.type == "cuda")
    ema = AveragedModel(model, multi_avg_fn=get_ema_multi_avg_fn(args.ema_decay), use_buffers=True)
    loss_fn = nn.CrossEntropyLoss(weight=None if class_weights is None else class_weights.to(device),
                                  label_smoothing=args.label_smoothing)

    best_f1, best_metrics, stale = -1.0, {}, 0
    with open(out_dir / "history.csv", "w", newline="", encoding="utf-8") as hf:
        history = csv.writer(hf)
        history.writerow(["epoch", "train_loss", "val_accuracy", "val_macro_f1", "lr", "seconds"])
        for epoch in range(1, args.epochs + 1):
            model.train()
            start, loss_sum, steps = time.time(), 0.0, 0
            for x, y in train_dl:
                x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
                with torch.autocast(device.type, enabled=device.type == "cuda"):
                    if mix_fn is not None:
                        x, soft = mix_fn(x, y)
                        loss = soft_cross_entropy(model(x).float(), soft)
                    else:
                        loss = loss_fn(model(x).float(), y)
                optimizer.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                ema.update_parameters(model)
                loss_sum, steps = loss_sum + loss.item(), steps + 1

            candidates = [(name, candidate, classification_metrics(*predict(candidate, val_dl, device, tta), labels))
                          for name, candidate in (("raw", model), ("ema", ema.module))]
            weights, selected, val = max(candidates, key=lambda item: item[2]["macro_f1"])
            val["weights"] = weights
            history.writerow([epoch, round(loss_sum / max(1, steps), 4), round(val["accuracy"], 4),
                              round(val["macro_f1"], 4), f"{scheduler.get_last_lr()[-1]:.2e}",
                              round(time.time() - start, 1)])
            hf.flush()
            log.info("epoch %d  loss %.4f  val acc %.4f  val macro-F1 %.4f  (%.0fs)", epoch,
                     loss_sum / max(1, steps), val["accuracy"], val["macro_f1"], time.time() - start)
            if val["macro_f1"] > best_f1:
                best_f1, best_metrics, stale = val["macro_f1"], val, 0
                torch.save({"state_dict": selected.state_dict(), "labels": labels, "weights": weights,
                            "config": {k: str(v) for k, v in vars(args).items()}},  # plain strings: safe torch.load
                           out_dir / "best.pt")
            else:
                stale += 1
                if stale >= args.patience:
                    log.info("early stop: no val macro-F1 gain for %d epochs", args.patience)
                    break

    model.load_state_dict(torch.load(out_dir / "best.pt", map_location=device)["state_dict"])
    return model.eval(), best_metrics


def finish(model: nn.Module, test_dl, labels: list[str], args, device: torch.device, out_dir: Path,
           val_best: dict, example: torch.Tensor, preprocess: dict, tta: Callable | None = None) -> dict:
    """Score the best model on test, export ONNX, and write metrics.json and preprocess.json."""
    test = classification_metrics(*predict(model, test_dl, device, tta), labels)
    log.info("TEST  acc %.4f  macro-F1 %.4f", test["accuracy"], test["macro_f1"])
    for name, c in test["per_class"].items():
        log.info("  %-9s f1 %.3f  recall %.3f  n=%d", name, c["f1"], c["recall"], c["support"])
    (out_dir / "metrics.json").write_text(json.dumps(
        {"val_best": val_best, "test": test, "config": {k: str(v) for k, v in vars(args).items()}}, indent=2))
    (out_dir / "preprocess.json").write_text(json.dumps({**preprocess, "labels": labels}, indent=2))
    torch.onnx.export(model.cpu().eval(), example, out_dir / "model.onnx", input_names=["input"],
                      output_names=["logits"], dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
                      opset_version=17, dynamo=False)
    return test
