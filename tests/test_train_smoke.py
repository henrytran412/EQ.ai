"""End-to-end smoke tests: train 1 epoch on tiny fake data on CPU and check every output.

Run with the training venv: .venv/Scripts/python -m unittest tests.test_train_smoke
Skipped automatically when PyTorch is not installed.
"""

import csv
import importlib.util
import json
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

HAS_TORCH = all(importlib.util.find_spec(m) for m in ("torch", "torchaudio", "timm", "transformers", "soundfile"))
EMOTIONS = ("anger", "disgust", "fear", "happy", "neutral", "sad", "surprise")


def fake_face_data(root: Path) -> None:
    from PIL import Image
    import random
    rng = random.Random(0)
    rows = []
    for split, n in (("train", 3), ("val", 2), ("test", 2)):
        for label in EMOTIONS:
            for i in range(n):
                rel = f"{split}/{label}/{i}.jpg"
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (48, 48), tuple(rng.randrange(256) for _ in range(3))).save(root / rel)
                rows.append({"path": rel, "split": split, "label": label})
    with open(root / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "split", "label"])
        writer.writeheader()
        writer.writerows(rows)


def fake_voice_data(root: Path) -> None:
    import math
    rows = []
    for split, actor in (("train", 1), ("val", 19), ("test", 21)):
        for k, label in enumerate(EMOTIONS):
            rel = f"Actor_{actor:02d}/{label}.wav"
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(root / rel), "wb") as w:  # 1.5 s tone, shorter than the 3 s window
                w.setnchannels(1), w.setsampwidth(2), w.setframerate(22050)
                w.writeframes(b"".join(int(8000 * math.sin(2 * math.pi * (200 + 50 * k) * t / 22050))
                                       .to_bytes(2, "little", signed=True) for t in range(33075)))
            rows.append({"path": rel, "split": split, "label": label, "actor": actor})
    with open(root / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["path", "split", "label", "actor"])
        writer.writeheader()
        writer.writerows(rows)


def check_outputs(test: unittest.TestCase, out: Path) -> dict:
    for name in ("best.pt", "model.onnx", "preprocess.json", "metrics.json", "history.csv"):
        test.assertTrue((out / name).is_file(), f"missing {name}")
    prep = json.loads((out / "preprocess.json").read_text())
    test.assertEqual(prep["labels"], list(EMOTIONS))
    metrics = json.loads((out / "metrics.json").read_text())
    test.assertEqual(set(metrics["test"]["per_class"]), set(EMOTIONS))
    test.assertIn("macro_f1", metrics["val_best"])
    return prep


@unittest.skipUnless(HAS_TORCH, "PyTorch not installed")
class FaceTrainingSmoke(unittest.TestCase):
    def test_one_epoch_produces_all_outputs(self):
        import train_face
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fake_face_data(data)
            train_face.main(["--data-dir", str(data), "--out-dir", str(out), "--model", "mobilenetv3_small_050",
                             "--no-pretrained", "--epochs", "1", "--batch-size", "8", "--img-size", "64",
                             "--workers", "0"])
            prep = check_outputs(self, out)
            self.assertEqual(prep["img_size"], 64)
            self.assertEqual(len(prep["mean"]), 3)


@unittest.skipUnless(HAS_TORCH, "PyTorch not installed")
class VoiceTrainingSmoke(unittest.TestCase):
    def run_arch(self, arch: str) -> dict:
        import train_voice
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fake_voice_data(data)
            train_voice.main(["--audio-dir", str(data), "--manifest", str(data / "manifest.csv"),
                              "--out-dir", str(out), "--arch", arch, "--no-pretrained", "--epochs", "1",
                              "--batch-size", "4", "--workers", "0"])
            return check_outputs(self, out)

    def test_mel_cnn_one_epoch(self):
        prep = self.run_arch("mel_cnn")
        self.assertEqual(prep["sample_rate"], 16000)
        self.assertEqual(prep["window_sec"], 3.0)

    def test_wavlm_one_epoch(self):
        prep = self.run_arch("wavlm")
        self.assertEqual(prep["sample_rate"], 16000)


if __name__ == "__main__":
    unittest.main()
