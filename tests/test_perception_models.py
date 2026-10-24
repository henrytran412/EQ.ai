"""ONNX Runtime provider choice for the perception models."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_DEPS = all(importlib.util.find_spec(m) for m in ("onnxruntime", "cv2", "numpy"))


@unittest.skipUnless(HAS_DEPS, "onnxruntime/opencv/numpy not installed")
class ProviderChoice(unittest.TestCase):
    def test_gpu_build_without_tensorrt_libraries_still_runs_on_cuda(self):
        # The Jetson onnxruntime build lists TensorRT, but TensorRT isn't installed; asking for it
        # made onnxruntime fall back to CPU only (measured on the Jetson, 2026-10-24).
        from services.perception import models
        available = ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
        with mock.patch.object(models.ort, "get_available_providers", return_value=available), \
                mock.patch.object(models.ort, "InferenceSession") as session:
            models._session(Path("model.onnx"))
        self.assertEqual(session.call_args.kwargs["providers"], ["CUDAExecutionProvider", "CPUExecutionProvider"])


if __name__ == "__main__":
    unittest.main()
