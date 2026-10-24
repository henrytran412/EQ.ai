"""Runs on Kaggle. launch.py fills in COMMIT and JOBS, then pushes this file as the kernel.

Clones the public repo at an exact commit and hands off to training/kaggle/runner.py, which
finds the attached datasets and runs the jobs. Results land in /kaggle/working/out/<job>.
"""

import json
import subprocess
import sys

COMMIT = "__COMMIT__"
JOBS = __JOBS__  # [{"kind": "face" | "voice", "name": str, "args": [str, ...]}]
REPO = "https://github.com/henrytran412/EQ.ai.git"
CODE = "/kaggle/tmp/eqai"


def sh(cmd: list[str], check: bool = True) -> int:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=check).returncode


sh(["nvidia-smi"], check=False)
sh(["git", "clone", "-q", REPO, CODE])
sh(["git", "-C", CODE, "checkout", "-q", COMMIT])
sh([sys.executable, "-m", "pip", "install", "-q", "timm", "soundfile"], check=False)
sys.exit(sh([sys.executable, f"{CODE}/training/kaggle/runner.py", "--jobs", json.dumps(JOBS)], check=False))
