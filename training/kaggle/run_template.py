"""Runs on Kaggle. launch.py fills in COMMIT and JOBS, then pushes this file as the kernel.

Clones the public repo at an exact commit and hands off to training/kaggle/runner.py, which
finds the attached datasets and runs the jobs. Results land in /kaggle/working/out/<job>.
"""

import json
import subprocess
import sys
from pathlib import Path
import hashlib

COMMIT = "__COMMIT__"
JOBS = __JOBS__  # [{"kind": "face" | "voice", "name": str, "args": [str, ...]}]
SNAPSHOT = __SNAPSHOT__
REPO = "https://github.com/henrytran412/EQ.ai.git"
CODE = "/kaggle/tmp/eqai"


def sh(cmd: list[str], check: bool = True) -> int:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=check).returncode


sh(["nvidia-smi"], check=False)
if SNAPSHOT:
    for name, content in SNAPSHOT.items():
        target = Path(CODE) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    digest = hashlib.sha256(json.dumps(SNAPSHOT, sort_keys=True).encode()).hexdigest()
    print("Training source snapshot SHA256:", digest, flush=True)
    Path('/kaggle/working/source_snapshot.json').write_text(json.dumps(
        {"base_commit": COMMIT, "sha256": digest, "files": SNAPSHOT, "jobs": JOBS}), encoding='utf-8')
else:
    sh(["git", "clone", "-q", REPO, CODE])
    sh(["git", "-C", CODE, "checkout", "-q", COMMIT])
sh([sys.executable, "-m", "pip", "install", "-q", "timm", "soundfile", "transformers", "onnx"])
sys.exit(sh([sys.executable, f"{CODE}/training/kaggle/runner.py", "--jobs", json.dumps(JOBS)], check=False))
