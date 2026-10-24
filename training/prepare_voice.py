"""Build a clean 7-emotion manifest for RAVDESS speech, split by actor.

Reads training/voice/data/RAVDESS/Actor_XX/*.wav and writes
training/voice/data/manifest.csv. Raw audio is never moved or deleted.

RAVDESS filenames are 7 dash-separated codes:
modality-vocal_channel-emotion-intensity-statement-repetition-actor.
We keep speech (vocal channel 01) and drop "calm" (02), which has no face match.
Splits are by actor so no speaker appears in two splits; odd actors are male,
even actors female, and each split keeps both.
"""

import argparse
import csv
import logging
from collections import Counter
from pathlib import Path

from emotions import EMOTIONS

RAVDESS_EMOTION = {"01": "neutral", "03": "happy", "04": "sad", "05": "anger",
                   "06": "fear", "07": "disgust", "08": "surprise"}  # "02" calm is dropped
VAL_ACTORS = {19, 20}
TEST_ACTORS = {21, 22, 23, 24}
log = logging.getLogger("prepare_voice")

assert set(RAVDESS_EMOTION.values()) == set(EMOTIONS)


def parse_name(filename: str) -> dict | None:
    """Return label/actor/intensity for a RAVDESS speech clip, or None if it is skipped."""
    parts = Path(filename).stem.split("-")
    if len(parts) != 7 or parts[1] != "01" or parts[2] not in RAVDESS_EMOTION:
        return None
    actor = int(parts[6])
    return {"label": RAVDESS_EMOTION[parts[2]], "actor": actor,
            "intensity": "strong" if parts[3] == "02" else "normal",
            "gender": "male" if actor % 2 else "female"}


def actor_split(actor: int) -> str:
    return "test" if actor in TEST_ACTORS else "val" if actor in VAL_ACTORS else "train"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).parent / "voice" / "data")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    wavs = sorted((args.data_dir / "RAVDESS").rglob("*.wav"))
    rows, skipped = [], 0
    for wav in wavs:
        info = parse_name(wav.name)
        if info is None:
            skipped += 1
            continue
        rows.append({"path": wav.relative_to(args.data_dir).as_posix(),
                     "split": actor_split(info["actor"]), **info})

    out = args.data_dir / "manifest.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "split", "label", "actor", "gender", "intensity"])
        writer.writeheader()
        writer.writerows(rows)

    log.info("scanned %d clips, kept %d, skipped %d (calm or not speech) -> %s",
             len(wavs), len(rows), skipped, out)
    for split in ("train", "val", "test"):
        part = [r for r in rows if r["split"] == split]
        log.info("  %-5s %4d clips, actors %s, %s", split, len(part),
                 sorted({r["actor"] for r in part}), dict(sorted(Counter(r["label"] for r in part).items())))


if __name__ == "__main__":
    main()
