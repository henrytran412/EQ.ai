"""compare_runs: one honest table across training runs (val picks the winner, test is reported)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

from compare_runs import compare  # noqa: E402

LABELS = ["anger", "disgust", "fear", "happy", "neutral", "sad", "surprise"]


def write_run(root: Path, name: str, val_f1: float, test_f1: float, test_acc: float) -> None:
    per_class = {c: {"precision": 0.5, "recall": 0.5, "f1": test_f1, "support": 10} for c in LABELS}
    metrics = {"val_best": {"macro_f1": val_f1, "accuracy": val_f1},
               "test": {"macro_f1": test_f1, "accuracy": test_acc, "per_class": per_class}}
    (root / name).mkdir(parents=True)
    (root / name / "metrics.json").write_text(json.dumps(metrics))


class CompareRuns(unittest.TestCase):
    def test_winner_per_kind_is_chosen_by_val_not_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_run(root, "face_mnv3", val_f1=0.60, test_f1=0.70, test_acc=0.71)
            write_run(root, "face_convnext", val_f1=0.65, test_f1=0.66, test_acc=0.68)
            write_run(root, "voice_wavlm", val_f1=0.40, test_f1=0.35, test_acc=0.36)
            report = compare(root)
        self.assertEqual(report["winners"], {"face": "face_convnext", "voice": "voice_wavlm"})
        self.assertIn("| face_convnext | 0.650 | 0.660 | 0.680 |", report["table"])

    def test_failed_run_without_metrics_is_listed_not_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_run(root, "face_mnv3", 0.6, 0.6, 0.6)
            (root / "voice_mel").mkdir()  # job crashed before writing metrics.json
            report = compare(root)
        self.assertEqual(report["missing"], ["voice_mel"])
        self.assertEqual(report["winners"], {"face": "face_mnv3"})


if __name__ == "__main__":
    unittest.main()
