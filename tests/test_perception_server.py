"""Perception WebSocket server with fake detector/classifiers (no trained models needed)."""

import importlib.util
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_DEPS = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx", "cv2", "numpy", "PIL"))
LABELS = ["anger", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
ORIGIN = {"origin": "http://localhost:5173"}


def jpeg(width=320, height=240) -> bytes:
    import cv2
    import numpy as np
    ok, buf = cv2.imencode(".jpg", np.full((height, width, 3), 128, np.uint8))
    return b"\x01" + buf.tobytes()


def audio(seconds: float, amplitude: float = 0.1) -> list[bytes]:
    import numpy as np
    t = np.arange(int(16000 * seconds)) / 16000
    wave = (amplitude * np.sin(2 * np.pi * 220 * t)).astype("<f4")
    return [b"\x02" + chunk.tobytes() for chunk in np.array_split(wave, max(1, int(seconds * 4)))]


@unittest.skipUnless(HAS_DEPS, "fastapi/httpx/opencv/numpy/pillow not installed")
class PerceptionServer(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from services.perception.server import create_app

        class FakeDetector:
            boxes = [(100, 60, 80, 80)]
            calls = 0

            def detect(self, bgr):
                self.calls += 1
                return list(self.boxes)

        class FakeFace:
            labels = LABELS

            def predict(self, rgb):
                assert rgb.shape[2] == 3 and rgb.shape[0] > 0
                return [0.05, 0.05, 0.6, 0.1, 0.1, 0.05, 0.05]  # fear

        class FakeVoice:
            labels = LABELS
            window_sec = 3.0

            def predict(self, wav):
                assert len(wav) == 48000
                return [0.1, 0.0, 0.0, 0.0, 0.8, 0.1, 0.0]  # neutral

        self.posted = []
        self.detector = FakeDetector()
        app = create_app(detector=self.detector, face=FakeFace(), voice=FakeVoice(),
                         post_signals=lambda body: self.posted.append(body),
                         allowed_origins=["http://localhost:5173"], min_interval_sec=0, min_frame_sec=0)
        self.client = TestClient(app)
        self.make_app = lambda **kw: TestClient(create_app(
            detector=self.detector, face=FakeFace(), voice=FakeVoice(), post_signals=lambda body: None,
            allowed_origins=["http://localhost:5173"], min_interval_sec=0, **kw))

    def test_camera_frame_gives_face_reading_with_tracked_box(self):
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(jpeg())
            reading = ws.receive_json()
        self.assertEqual(reading["type"], "reading")
        self.assertEqual(reading["face"]["label"], "fear")
        x, y, w, h = reading["face"]["box"]
        self.assertTrue(0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 and 0 < h <= 1)
        self.assertIsNone(reading["voice"])

    def test_frames_faster_than_the_app_sends_are_dropped(self):
        client = self.make_app()  # default frame cap; the web app sends one frame every 500 ms
        with client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            for _ in range(6):
                ws.send_bytes(jpeg())
            ws.receive_json()
        self.assertEqual(self.detector.calls, 1)  # one socket spamming frames can't hog the GPU

    def test_three_seconds_of_speech_gives_voice_reading(self):
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            for chunk in audio(3.0):
                ws.send_bytes(chunk)
                reading = ws.receive_json()
        self.assertEqual(reading["voice"]["label"], "neutral")

    def test_silence_does_not_run_the_voice_model(self):
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            for chunk in audio(3.0, amplitude=0.0):
                ws.send_bytes(chunk)
                reading = ws.receive_json()
        self.assertIsNone(reading["voice"])

    def test_no_face_in_frame_gives_no_face_reading(self):
        self.detector.boxes = []
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(jpeg())
            self.assertIsNone(ws.receive_json()["face"])

    def test_dialogue_gets_labels_only_never_media(self):
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(jpeg())
            ws.receive_json()
        self.assertEqual(self.posted[-1], {"session_id": "s1", "face": {"label": "fear", "confidence": 0.6},
                                           "voice": None})

    def test_bad_origin_is_refused(self):
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/ws/s1", headers={"origin": "http://evil.example"}) as ws:
                ws.receive_json()

    def test_malformed_message_closes_the_socket(self):
        from starlette.websockets import WebSocketDisconnect
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(b"\x09junk")
            with self.assertRaises(WebSocketDisconnect):
                ws.receive_json()

    def test_huge_image_is_skipped_without_decoding(self):
        import io
        from PIL import Image
        buf = io.BytesIO()
        Image.new("1", (4000, 3000)).save(buf, "PNG")  # 12 megapixels in a few KB: a decode would be ~36 MB
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(b"\x01" + buf.getvalue())
            ws.send_bytes(jpeg())
            self.assertEqual(ws.receive_json()["face"]["label"], "fear")
        self.assertEqual(self.detector.calls, 1)  # only the real frame reached the detector

    def test_too_many_open_sockets_are_refused(self):
        from starlette.websockets import WebSocketDisconnect
        client = self.make_app(max_sockets=1, min_frame_sec=0)
        with client.websocket_connect("/ws/s1", headers=ORIGIN) as first:
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect("/ws/s2", headers=ORIGIN) as second:
                    second.receive_json()
            first.send_bytes(jpeg())
            self.assertEqual(first.receive_json()["type"], "reading")  # the open socket keeps working
        with client.websocket_connect("/ws/s3", headers=ORIGIN) as again:  # closing frees the slot
            again.send_bytes(jpeg())
            self.assertEqual(again.receive_json()["type"], "reading")

    def test_undecodable_jpeg_is_skipped_not_fatal(self):
        with self.client.websocket_connect("/ws/s1", headers=ORIGIN) as ws:
            ws.send_bytes(b"\x01not a jpeg")
            ws.send_bytes(jpeg())
            self.assertEqual(ws.receive_json()["face"]["label"], "fear")


if __name__ == "__main__":
    unittest.main()
