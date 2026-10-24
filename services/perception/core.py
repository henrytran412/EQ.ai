"""Perception building blocks with no model or network dependency (unit tested).

Raw frames and audio only ever live in memory here; nothing is written to disk.
"""

import math
from collections import deque

import numpy as np
from PIL import Image

MAX_FRAME_BYTES = 500_000  # one JPEG, <= 640 px wide
MAX_AUDIO_BYTES = 64_000   # ~1 s of float32 audio at 16 kHz
VIDEO, AUDIO = 0x01, 0x02


def parse_message(data: bytes) -> tuple[str, object]:
    """Binary WebSocket message -> ("video", jpeg bytes) or ("audio", float32 samples)."""
    if len(data) < 2:
        raise ValueError("empty message")
    kind, payload = data[0], data[1:]
    if kind == VIDEO:
        if len(payload) > MAX_FRAME_BYTES:
            raise ValueError("frame too large")
        return "video", payload
    if kind == AUDIO:
        if len(payload) > MAX_AUDIO_BYTES or len(payload) % 4:
            raise ValueError("bad audio chunk")
        return "audio", np.frombuffer(payload, dtype="<f4")
    raise ValueError(f"unknown message type {kind}")


def expand_box(box, frame_w: int, frame_h: int, width_ratio: float = 1.52,
               height_ratio: float = 1.19) -> tuple[int, int, int, int]:
    """YuNet face box -> square crop framed like the AffectNet training images, clipped to the frame.

    Ratios measured on 300 AffectNet test images: the 96x96 crop is a median 1.52x the YuNet box
    width and 1.19x its height, centered on the box (offset under 2%).
    """
    x, y, w, h = box
    side = max(w * width_ratio, h * height_ratio)
    cx, cy = x + w / 2, y + h / 2
    x1, y1 = max(0, round(cx - side / 2)), max(0, round(cy - side / 2))
    x2, y2 = min(frame_w, round(cx + side / 2)), min(frame_h, round(cy + side / 2))
    return x1, y1, x2 - x1, y2 - y1


def iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    inter = max(0, min(ax2, bx2) - max(a[0], b[0])) * max(0, min(ay2, by2) - max(a[1], b[1]))
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union else 0.0


def pick_face(boxes: list, previous) -> tuple | None:
    """Keep following the student's face across frames; on the first frame take the biggest face."""
    if not boxes:
        return None
    if previous is not None:
        best = max(boxes, key=lambda b: iou(b, previous))
        if iou(best, previous) > 0.3:
            return tuple(best)
    return tuple(max(boxes, key=lambda b: b[2] * b[3]))


def face_input(rgb: np.ndarray, img_size: int, mean, std) -> np.ndarray:
    """RGB uint8 crop -> (1, 3, S, S) float32, same steps as training's eval transform."""
    resized = Image.fromarray(rgb).resize((img_size, img_size), Image.BILINEAR)
    x = (np.asarray(resized, dtype=np.float32) / 255.0 - np.asarray(mean, np.float32)) / np.asarray(std, np.float32)
    return x.transpose(2, 0, 1)[None].astype(np.float32)


class EmaSmoother:
    """Exponential moving average of class probabilities so one noisy frame can't flip the label."""

    def __init__(self, labels: list[str], alpha: float = 0.3, timeout_sec: float = 3.0):
        self.labels, self.alpha, self.timeout = labels, alpha, timeout_sec
        self.probs, self.last = None, None

    def update(self, probs, now: float) -> dict:
        p = np.asarray(probs, dtype=np.float64)
        expired = self.last is None or now - self.last > self.timeout
        self.probs = p if expired else self.alpha * p + (1 - self.alpha) * self.probs
        self.probs = self.probs / self.probs.sum()
        self.last = now
        return self._reading()

    def current(self, now: float) -> dict | None:
        if self.last is None or now - self.last > self.timeout:
            return None
        return self._reading()

    def _reading(self) -> dict:
        i = int(self.probs.argmax())
        return {"label": self.labels[i], "confidence": round(float(self.probs[i]), 3),
                "probs": {name: round(float(v), 3) for name, v in zip(self.labels, self.probs)}}


class AudioWindow:
    """Keeps only the newest window_sec of audio."""

    def __init__(self, sample_rate: int = 16000, window_sec: float = 3.0):
        self.size = int(sample_rate * window_sec)
        self.buffer = deque(maxlen=self.size)
        self.total = 0

    def push(self, samples: np.ndarray) -> None:
        self.buffer.extend(samples.tolist())
        self.total += len(samples)

    def window(self) -> np.ndarray | None:
        if self.total < self.size:
            return None
        return np.asarray(self.buffer, dtype=np.float32)


def is_speech(samples: np.ndarray, threshold_dbfs: float = -40.0) -> bool:
    """Energy check: skip the voice classifier on silence. shortcut: no real VAD; noisy rooms will pass."""
    rms = math.sqrt(float(np.mean(np.square(samples)))) if len(samples) else 0.0
    return rms > 0 and 20 * math.log10(rms) > threshold_dbfs
