"""Real detector and classifiers for the Jetson (or a laptop CPU for development).

Expected layout (PERCEPTION_MODELS, default <repo>/models):
  face_detection_yunet_2023mar.onnx      OpenCV Zoo face detector (scripts/fetch_models.sh)
  face/model.onnx + face/preprocess.json   from training/runs/<face run>/
  voice/model.onnx + voice/preprocess.json from training/runs/<voice run>/
Anything missing is skipped with a warning, so the server still runs with what exists.
"""

import json
import logging
import os
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .core import face_input

log = logging.getLogger("perception")
REPO = Path(__file__).resolve().parents[2]


def _session(path: Path) -> ort.InferenceSession:
    # Not TensorRT: it isn't installed on the Jetson, and requesting it drops onnxruntime to CPU, not CUDA.
    wanted = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    providers = [p for p in wanted if p in ort.get_available_providers()]
    session = ort.InferenceSession(str(path), providers=providers)
    log.info("%s on %s", path.name, session.get_providers()[0])
    return session


def _softmax(logits: np.ndarray) -> list[float]:
    e = np.exp(logits - logits.max())
    return (e / e.sum()).tolist()


class OnnxFace:
    def __init__(self, model_dir: Path):
        prep = json.loads((model_dir / "preprocess.json").read_text())
        self.labels, self.size, self.mean, self.std = prep["labels"], prep["img_size"], prep["mean"], prep["std"]
        self.session = _session(model_dir / "model.onnx")

    def predict(self, rgb: np.ndarray) -> list[float]:
        return _softmax(self.session.run(None, {"input": face_input(rgb, self.size, self.mean, self.std)})[0][0])


class OnnxVoice:
    def __init__(self, model_dir: Path):
        prep = json.loads((model_dir / "preprocess.json").read_text())
        self.labels, self.window_sec = prep["labels"], prep["window_sec"]
        self.session = _session(model_dir / "model.onnx")

    def predict(self, wav: np.ndarray) -> list[float]:
        return _softmax(self.session.run(None, {"input": wav[None].astype(np.float32)})[0][0])


class YuNetDetector:
    def __init__(self, model_path: Path, score_threshold: float = 0.7):
        self.detector = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), score_threshold)

    def detect(self, bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
        self.detector.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, faces = self.detector.detect(bgr)
        return [] if faces is None else [tuple(int(v) for v in f[:4]) for f in faces]


def load_defaults():
    root = Path(os.environ.get("PERCEPTION_MODELS", REPO / "models"))
    detector_path = root / "face_detection_yunet_2023mar.onnx"
    detector = YuNetDetector(detector_path) if detector_path.is_file() else None
    face = OnnxFace(root / "face") if (root / "face" / "model.onnx").is_file() else None
    voice = OnnxVoice(root / "voice") if (root / "voice" / "model.onnx").is_file() else None
    for name, part in (("face detector", detector), ("face model", face), ("voice model", voice)):
        if part is None:
            log.warning("%s missing under %s; that signal is disabled", name, root)
    return detector, face, voice
