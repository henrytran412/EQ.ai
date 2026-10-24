"""Speed perturbation must use round resampling ratios: random ratios took 0.9-3.6 s per clip."""

import importlib.util
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

HAS_TORCH = all(importlib.util.find_spec(m) for m in ("torch", "torchaudio", "timm", "transformers", "soundfile"))


@unittest.skipUnless(HAS_TORCH, "training libraries not installed")
class SpeedPerturbation(unittest.TestCase):
    def test_every_speed_has_a_cheap_resampling_ratio(self):
        from train_voice import SAMPLE_RATE, SPEED_RATES
        for rate in SPEED_RATES:
            self.assertGreaterEqual(math.gcd(rate, SAMPLE_RATE), 800, f"{rate} Hz makes a huge resampling kernel")
        self.assertEqual(min(SPEED_RATES), 14400)
        self.assertEqual(max(SPEED_RATES), 17600)

    def test_speeding_up_shortens_the_clip(self):
        import torch
        from train_voice import change_speed
        wav = torch.randn(16000)
        self.assertEqual(len(change_speed(wav, 16000)), 16000)  # 1.0x is a no-op
        self.assertAlmostEqual(len(change_speed(wav, 17600)), 16000 / 1.1, delta=2)


if __name__ == "__main__":
    unittest.main()
