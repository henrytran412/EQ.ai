#!/usr/bin/env bash
# One-time setup on the Jetson Orin (L4T 39.2, Ubuntu 24.04, Python 3.12, CUDA 13.2 driver). No sudo needed.
# The system Python has no pip and there is no CUDA toolkit, so pip, the CUDA/cuDNN libraries and the GPU build
# of onnxruntime all go into .venv. Versions below were tested on 2026-10-24 (GPU output matched CPU).
# Usage from the repo root (~/eq-ai):  scripts/setup_jetson.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PIP_CACHE_DIR="$PWD/.cache/pip"  # keep downloads inside the project folder
mkdir -p .cache

if [ ! -x .venv/bin/pip ]; then
  python3 -m venv --without-pip .venv
  curl -fsSL https://bootstrap.pypa.io/get-pip.py -o .cache/get-pip.py
  .venv/bin/python .cache/get-pip.py -q
fi
pip=.venv/bin/pip

# Service packages, minus the CPU onnxruntime: it shares the onnxruntime folder with the GPU build.
grep -hv '^onnxruntime' services/perception/requirements.txt services/dialogue/requirements.txt | $pip install -q -r /dev/stdin
$pip uninstall -y -q onnxruntime 2>/dev/null || true

# CUDA 13 runtime, cuBLAS and cuDNN from PyPI ...
$pip install -q nvidia-cuda-runtime==13.4.92 nvidia-cuda-nvrtc==13.4.92 nvidia-nvjitlink==13.4.92 \
  nvidia-cublas==13.8.1.7 nvidia-cudnn-cu13==9.27.0.42 nvidia-cufft==12.4.0.43 nvidia-curand==10.4.4.72 \
  flatbuffers packaging protobuf sympy
# ... and NVIDIA's Jetson build of onnxruntime: the PyPI onnxruntime-gpu has no Orin (sm_87) kernels.
$pip install -q --no-deps --force-reinstall --index-url https://pypi.jetson-ai-lab.io/sbsa/cu130/+simple onnxruntime-gpu==1.24.0

.venv/bin/python -c "import onnxruntime as o; print('onnxruntime', o.__version__, o.get_available_providers())"
