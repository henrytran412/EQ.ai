"""Fine-tune an ImageNet-pretrained CNN (timm) on the cleaned 7-emotion face manifest.

Example (Kaggle GPU):
  python training/train_face.py --data-dir /kaggle/input/eq-ai-affectnet-7class --out-dir out/face_convnext
  python training/train_face.py --model mobilenetv3_large_100 ...   # baseline, same family as the old project
"""

import argparse
import csv
import logging
from collections import Counter
from pathlib import Path

import timm
import torch
from PIL import Image
from timm.data import Mixup, resolve_data_config
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import transforms as T

from emotions import EMOTIONS
from loop import finish, fit, pick_device, set_seed

log = logging.getLogger("train")


class FaceDataset(Dataset):
    def __init__(self, rows: list[dict], root: Path, transform):
        self.rows, self.root, self.transform = rows, root, transform

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        row = self.rows[i]
        image = Image.open(self.root / row["path"]).convert("RGB")
        return self.transform(image), EMOTIONS.index(row["label"])


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data-dir", type=Path, required=True, help="folder with manifest.csv and train/val/test")
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--manifest", type=Path, help="Override the dataset's bundled manifest")
    p.add_argument("--model", default="convnext_tiny.fb_in22k_ft_in1k")
    p.add_argument("--pretrained", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--img-size", type=int, default=224)
    p.add_argument("--lr", type=float, default=1e-3, help="head learning rate")
    p.add_argument("--backbone-lr", type=float, default=1e-4)
    p.add_argument("--weight-decay", type=float, default=0.05)
    p.add_argument("--label-smoothing", type=float, default=0.1)
    p.add_argument("--mix-prob", type=float, default=0.5, help="chance a batch gets Mixup/CutMix; 0 disables")
    p.add_argument("--drop-path", type=float, default=0.1)
    p.add_argument("--ema-decay", type=float, default=0.999)
    p.add_argument("--patience", type=int, default=6)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    set_seed(args.seed)
    device = pick_device()
    labels = list(EMOTIONS)

    with open(args.manifest or args.data_dir / "manifest.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    splits = {s: [r for r in rows if r["split"] == s] for s in ("train", "val", "test")}
    log.info("device %s | %s", device, {s: len(r) for s, r in splits.items()})

    model = timm.create_model(args.model, pretrained=args.pretrained, num_classes=len(labels),
                              drop_path_rate=args.drop_path).to(device)
    cfg = resolve_data_config({}, model=model)
    mean, std = list(cfg["mean"]), list(cfg["std"])
    size = args.img_size
    train_tf = T.Compose([T.RandomResizedCrop(size, scale=(0.7, 1.0)), T.RandomHorizontalFlip(),
                          T.TrivialAugmentWide(), T.ToTensor(), T.Normalize(mean, std), T.RandomErasing(p=0.25)])
    eval_tf = T.Compose([T.Resize((size, size)), T.ToTensor(), T.Normalize(mean, std)])

    counts = Counter(r["label"] for r in splits["train"])
    sampler = WeightedRandomSampler([1.0 / counts[r["label"]] for r in splits["train"]], len(splits["train"]))
    loader = dict(batch_size=args.batch_size, num_workers=args.workers, pin_memory=device.type == "cuda")
    train_dl = DataLoader(FaceDataset(splits["train"], args.data_dir, train_tf), sampler=sampler,
                          drop_last=True, **loader)  # Mixup needs even, full batches
    val_dl = DataLoader(FaceDataset(splits["val"], args.data_dir, eval_tf), **loader)
    test_dl = DataLoader(FaceDataset(splits["test"], args.data_dir, eval_tf), **loader)

    mix_fn = Mixup(mixup_alpha=0.2, cutmix_alpha=1.0, prob=args.mix_prob, label_smoothing=args.label_smoothing,
                   num_classes=len(labels)) if args.mix_prob > 0 else None
    flip = lambda x: torch.flip(x, dims=[3])  # noqa: E731 - test-time augmentation: mirrored face
    model, val_best = fit(model, model.get_classifier(), train_dl, val_dl, labels, args, device, args.out_dir,
                          mix_fn=mix_fn, tta=flip)
    finish(model, test_dl, labels, args, device, args.out_dir, val_best,
           example=torch.randn(1, 3, size, size),
           preprocess={"model": args.model, "img_size": size, "mean": mean, "std": std,
                       "input": "RGB face crop, resized to img_size, scaled to 0-1, then (x - mean) / std"},
           tta=flip)


if __name__ == "__main__":
    main()
