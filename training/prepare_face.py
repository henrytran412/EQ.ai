"""Build a clean 7-emotion manifest for the AffectNet face images.

Reads training/face/data/{train,val,test}/<emotion>/*.jpg and labels.csv, writes
training/face/data/manifest.csv. Raw images are never moved or deleted.

Cleaning rules:
- label comes from labels.csv (the relabelled column); the folder name is kept as
  folder_label for comparison
- drop rows labelled contempt and images with no usable label
- drop a labels.csv path that exists in several splits with different pixels (ambiguous)
- byte-identical copies are kept once, preferring train > val > test, so no test
  image was seen in training; copies with conflicting labels are all dropped
"""

import argparse
import csv
import hashlib
import logging
from collections import Counter, defaultdict
from pathlib import Path

from emotions import EMOTIONS

SPLITS = ("train", "val", "test")  # also the keep-priority order for duplicates
log = logging.getLogger("prepare_face")


def scan_images(data_dir: Path) -> list[dict]:
    images = []
    for split in SPLITS:
        for path in sorted((data_dir / split).rglob("*")):
            if path.is_file():
                rel = path.relative_to(data_dir / split).as_posix()
                images.append({
                    "path": f"{split}/{rel}",
                    "split": split,
                    "key": rel.lower(),  # labels.csv paths are relative to the split folder
                    "folder_label": rel.split("/")[0].lower(),  # test/ has "Anger"
                    "md5": hashlib.md5(path.read_bytes()).hexdigest(),
                })
    return images


def attach_labels(images: list[dict], label_rows: list[dict]) -> Counter:
    """Set image['label'] and image['relfcs'] from labels.csv; returns drop reasons."""
    by_key = defaultdict(list)
    for img in images:
        by_key[img["key"]].append(img)
    labels = {row["pth"].strip().lower(): row for row in label_rows}
    dropped = Counter()
    for key, imgs in by_key.items():
        row = labels.get(key)
        if row is None:
            dropped["no labels.csv row"] += len(imgs)
            continue
        if len({img["md5"] for img in imgs}) > 1:
            dropped["same path, different pixels across splits"] += len(imgs)
            continue
        label = row["label"].strip().lower()
        if label not in EMOTIONS:
            dropped[f"label {label}"] += len(imgs)
            continue
        for img in imgs:
            img["label"], img["relfcs"] = label, row.get("relFCs", "")
    return dropped


def dedupe(images: list[dict]) -> tuple[list[dict], Counter]:
    """Keep one copy per identical image; drop all copies when their labels disagree."""
    groups = defaultdict(list)
    for img in images:
        groups[img["md5"]].append(img)
    kept, dropped = [], Counter()
    for copies in groups.values():
        if len({img["label"] for img in copies}) > 1:
            dropped["identical image, conflicting labels"] += len(copies)
            continue
        copies.sort(key=lambda img: SPLITS.index(img["split"]))
        kept.append(copies[0])
        dropped["duplicate copy"] += len(copies) - 1
    return sorted(kept, key=lambda img: img["path"]), dropped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).parent / "face" / "data")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with open(args.data_dir / "labels.csv", newline="", encoding="utf-8") as f:
        label_rows = list(csv.DictReader(f))
    images = scan_images(args.data_dir)
    dropped = attach_labels(images, label_rows)
    kept, dup_dropped = dedupe([img for img in images if "label" in img])
    dropped.update(dup_dropped)

    out = args.data_dir / "manifest.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "split", "label", "folder_label", "relfcs", "md5"],
                                extrasaction="ignore")
        writer.writeheader()
        writer.writerows(kept)

    log.info("scanned %d images, kept %d -> %s", len(images), len(kept), out)
    for reason, n in dropped.most_common():
        log.info("  dropped %6d  %s", n, reason)
    for split in SPLITS:
        counts = Counter(img["label"] for img in kept if img["split"] == split)
        log.info("  %-5s %6d  %s", split, sum(counts.values()), dict(sorted(counts.items())))
    agree = sum(img["label"] == img["folder_label"] for img in kept)
    log.info("  label matches folder name for %d of %d kept images", agree, len(kept))


if __name__ == "__main__":
    main()
