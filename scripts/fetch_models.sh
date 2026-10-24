#!/usr/bin/env bash
# Download third-party pretrained files the perception service needs into models/ (gitignored).
# Trained face/voice classifiers come from Kaggle runs instead (see training/kaggle/launch.py).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

# OpenCV Zoo YuNet face detector (MIT license): https://github.com/opencv/opencv_zoo
YUNET=models/face_detection_yunet_2023mar.onnx
if [ ! -f "$YUNET" ]; then
  curl -fsSL -o "$YUNET" \
    https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
fi
python - "$YUNET" <<'EOF'
import sys
data = open(sys.argv[1], "rb").read()
assert not data.startswith(b"version https://git-lfs"), "got a Git LFS pointer, not the model"
assert len(data) > 100_000, f"model file too small ({len(data)} bytes)"
print(f"{sys.argv[1]}: {len(data)} bytes OK")
EOF
