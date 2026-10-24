"""Regression tests for review findings on the training code. Run with the training venv."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

HAS_TORCH = all(importlib.util.find_spec(m) for m in ("torch", "torchaudio", "timm", "transformers", "soundfile"))


@unittest.skipUnless(HAS_TORCH, "training libraries not installed")
class WavLMInput(unittest.TestCase):
    def test_wavlm_gets_the_raw_waveform(self):
        # microsoft/wavlm-base-plus preprocessor_config.json has do_normalize: false
        import torch
        from train_voice import WavLMClassifier

        clf = WavLMClassifier(pretrained=False, n_classes=7).eval()
        seen, inner_forward = {}, clf.model.forward

        def spy(input_values=None, **kwargs):
            seen["x"] = input_values
            return inner_forward(input_values=input_values, **kwargs)

        clf.model.forward = spy
        x = 0.05 * torch.randn(1, 16000)
        with torch.no_grad():
            clf(x)
        self.assertTrue(torch.equal(seen["x"], x))


@unittest.skipUnless(HAS_TORCH, "training libraries not installed")
class RawVersusEma(unittest.TestCase):
    def test_trained_raw_weights_win_when_the_ema_copy_lags(self):
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset
        from loop import fit

        torch.manual_seed(0)
        x = torch.randn(512, 2)
        y = (x[:, 0] > 0).long()
        model = nn.Sequential(nn.Linear(2, 16), nn.ReLU(), nn.Linear(16, 2))
        args = SimpleNamespace(epochs=3, lr=0.05, backbone_lr=0.05, weight_decay=0.0, label_smoothing=0.0,
                               ema_decay=0.99999, patience=5)  # EMA stays ~ the untrained weights
        train = DataLoader(TensorDataset(x, y), batch_size=32, shuffle=True)
        val = DataLoader(TensorDataset(x, y), batch_size=128)
        with tempfile.TemporaryDirectory() as tmp:
            best_model, best = fit(model, model[2], train, val, ["neg", "pos"], args, torch.device("cpu"), Path(tmp))
            with torch.no_grad():
                accuracy = (best_model(x).argmax(-1) == y).float().mean().item()
        self.assertEqual(best["weights"], "raw")
        self.assertGreater(best["macro_f1"], 0.9)
        self.assertGreater(accuracy, 0.9)  # the returned model really has the raw weights


if __name__ == "__main__":
    unittest.main()
