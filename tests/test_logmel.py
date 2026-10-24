"""The ONNX-friendly log-mel must match torchaudio's. Run with the training venv."""

import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))


@unittest.skipUnless(all(importlib.util.find_spec(m) for m in ("torch", "torchaudio", "timm", "soundfile")),
                     "training libraries not installed")
class LogMelMatchesTorchaudio(unittest.TestCase):
    def test_same_db_values_as_torchaudio(self):
        import torch
        import torchaudio
        from train_voice import LogMel

        wav = torch.randn(2, 16000)
        ours = LogMel()(wav)
        mel = torchaudio.transforms.MelSpectrogram(16000, n_fft=512, win_length=400, hop_length=160, n_mels=128,
                                                   center=False)(wav)
        ref = 10 * torch.log10(mel.clamp_min(1e-10))
        ref = torch.maximum(ref, ref.amax(dim=(1, 2), keepdim=True) - 80)
        self.assertEqual(ours.shape, ref.shape)
        self.assertLess((ours - ref).abs().max().item(), 1e-2)

    def test_exports_to_onnx(self):
        import tempfile
        import torch
        from train_voice import LogMel

        with tempfile.TemporaryDirectory() as tmp:
            torch.onnx.export(LogMel(), torch.randn(1, 16000), Path(tmp) / "m.onnx", opset_version=17, dynamo=False)


if __name__ == "__main__":
    unittest.main()
