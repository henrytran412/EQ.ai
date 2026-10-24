"""Checks for the evaluation metrics. Run: python -m unittest discover -s tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

from metrics import classification_metrics  # noqa: E402


class Metrics(unittest.TestCase):
    def test_perfect_predictions(self):
        m = classification_metrics([0, 1, 2], [0, 1, 2], ["a", "b", "c"])
        self.assertEqual(m["accuracy"], 1.0)
        self.assertEqual(m["macro_f1"], 1.0)

    def test_confusion_rows_are_true_labels(self):
        m = classification_metrics([0, 0, 1], [0, 1, 1], ["a", "b"])
        self.assertEqual(m["confusion"], [[1, 1], [0, 1]])

    def test_macro_f1_weights_every_class_equally(self):
        # class a: precision 1, recall 0.5 -> f1 2/3; class b: precision 0.5, recall 1 -> f1 2/3
        m = classification_metrics([0, 0, 1], [0, 1, 1], ["a", "b"])
        self.assertAlmostEqual(m["macro_f1"], 2 / 3)
        self.assertAlmostEqual(m["accuracy"], 2 / 3)
        self.assertEqual(m["per_class"]["a"]["support"], 2)

    def test_class_never_predicted_scores_zero_not_nan(self):
        m = classification_metrics([0, 1], [0, 0], ["a", "b"])
        self.assertEqual(m["per_class"]["b"]["f1"], 0.0)
        self.assertEqual(m["per_class"]["b"]["precision"], 0.0)
        self.assertAlmostEqual(m["macro_f1"], (2 / 3 + 0.0) / 2)


if __name__ == "__main__":
    unittest.main()
