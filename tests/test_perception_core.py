"""Perception building blocks: message parsing, face tracking geometry, smoothing, audio window."""

import importlib.util
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_NUMPY = importlib.util.find_spec("numpy") is not None
LABELS = ["anger", "disgust", "fear", "happy", "neutral", "sad", "surprise"]


@unittest.skipUnless(HAS_NUMPY, "numpy not installed")
class Messages(unittest.TestCase):
    def test_video_and_audio_frames_are_told_apart(self):
        from services.perception.core import parse_message
        kind, payload = parse_message(b"\x01" + b"\xff\xd8jpegdata")
        self.assertEqual((kind, payload), ("video", b"\xff\xd8jpegdata"))
        kind, samples = parse_message(b"\x02" + struct.pack("<3f", 0.1, -0.2, 0.3))
        self.assertEqual(kind, "audio")
        self.assertEqual([round(float(s), 3) for s in samples], [0.1, -0.2, 0.3])

    def test_oversized_unknown_or_malformed_messages_are_rejected(self):
        from services.perception.core import parse_message
        for bad in (b"", b"\x09abc", b"\x01" + b"x" * 600_000, b"\x02" + b"\x00" * 70_000, b"\x02abc"):
            with self.assertRaises(ValueError):
                parse_message(bad)


@unittest.skipUnless(HAS_NUMPY, "numpy not installed")
class FaceGeometry(unittest.TestCase):
    def test_expand_box_gives_square_affectnet_style_crop_inside_frame(self):
        from services.perception.core import expand_box
        # side = max(80 * 1.52, 80 * 1.19) = 121.6 around the box center (140, 140)
        self.assertEqual(expand_box((100, 100, 80, 80), 640, 480), (79, 79, 122, 122))
        self.assertEqual(expand_box((0, 0, 80, 80), 640, 480), (0, 0, 101, 101))  # clipped at the edge

    def test_tracking_follows_the_same_face_not_the_biggest(self):
        from services.perception.core import pick_face
        student, passerby = (100, 100, 80, 80), (300, 50, 150, 150)
        self.assertEqual(pick_face([student, passerby], previous=None), passerby)  # first frame: biggest
        self.assertEqual(pick_face([passerby, (105, 102, 80, 80)], previous=student), (105, 102, 80, 80))
        self.assertIsNone(pick_face([], previous=student))


@unittest.skipUnless(HAS_NUMPY, "numpy not installed")
class Smoothing(unittest.TestCase):
    def test_one_noisy_frame_does_not_flip_the_label(self):
        from services.perception.core import EmaSmoother
        s = EmaSmoother(LABELS, alpha=0.3, timeout_sec=3)
        happy = [0, 0, 0, 0.9, 0.1, 0, 0]
        anger = [0.9, 0, 0, 0, 0.1, 0, 0]
        for t in range(5):
            s.update(happy, now=t)
        reading = s.update(anger, now=5)
        self.assertEqual(reading["label"], "happy")
        self.assertAlmostEqual(sum(reading["probs"].values()), 1.0, places=5)

    def test_reading_expires_when_signal_stops(self):
        from services.perception.core import EmaSmoother
        s = EmaSmoother(LABELS, alpha=0.3, timeout_sec=3)
        s.update([0, 0, 0, 1, 0, 0, 0], now=0)
        self.assertIsNotNone(s.current(now=2))
        self.assertIsNone(s.current(now=4))


@unittest.skipUnless(HAS_NUMPY, "numpy not installed")
class AudioWindow(unittest.TestCase):
    def test_window_needs_enough_audio_then_returns_latest_samples(self):
        import numpy as np
        from services.perception.core import AudioWindow
        w = AudioWindow(sample_rate=10, window_sec=2.0)
        w.push(np.ones(15, dtype=np.float32))
        self.assertIsNone(w.window())
        w.push(np.arange(10, dtype=np.float32))
        latest = w.window()
        self.assertEqual(len(latest), 20)
        self.assertEqual(float(latest[-1]), 9.0)

    def test_silence_is_not_speech(self):
        import numpy as np
        from services.perception.core import is_speech
        self.assertFalse(is_speech(np.zeros(16000, dtype=np.float32)))
        self.assertTrue(is_speech(0.1 * np.sin(np.linspace(0, 2000, 16000)).astype(np.float32)))


@unittest.skipUnless(HAS_NUMPY, "numpy not installed")
class FaceInput(unittest.TestCase):
    def test_face_crop_becomes_normalized_nchw_tensor(self):
        import numpy as np
        from services.perception.core import face_input
        rgb = np.full((50, 40, 3), 255, dtype=np.uint8)
        x = face_input(rgb, img_size=32, mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
        self.assertEqual(x.shape, (1, 3, 32, 32))
        self.assertEqual(x.dtype, np.float32)
        self.assertAlmostEqual(float(x.max()), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
