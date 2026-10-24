"""Runs on Kaggle. launch.py fills in COMMIT and JOBS, then pushes this file as the kernel.

Clones the public repo at an exact commit, finds the attached datasets under /kaggle/input,
runs each training job, and leaves only the results in /kaggle/working/out.
"""

import glob
import os
import shutil
import subprocess
import sys
import zipfile

COMMIT = "__COMMIT__"
JOBS = __JOBS__  # [{"kind": "face" | "voice", "name": str, "args": [str, ...]}]
REPO = "https://github.com/henrytran412/EQ.ai.git"
WORK = "/kaggle/working"
CODE = "/kaggle/tmp/eqai"


def sh(cmd: list[str], check: bool = True) -> int:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=check).returncode


def face_dir() -> str:
    for manifest in glob.glob("/kaggle/input/**/manifest.csv", recursive=True):
        root = os.path.dirname(manifest)
        if os.path.isdir(os.path.join(root, "train")):
            return root
        if os.path.isfile(os.path.join(root, "train.zip")):  # in case Kaggle kept the zips
            out = "/kaggle/tmp/face"
            for split in ("train", "val", "test"):
                zipfile.ZipFile(os.path.join(root, f"{split}.zip")).extractall(os.path.join(out, split))
            shutil.copy(manifest, out)
            return out
    raise SystemExit("face dataset (manifest.csv + train/) not found under /kaggle/input")


def voice_dir() -> str:
    actors = sorted(glob.glob("/kaggle/input/**/Actor_01", recursive=True), key=len)
    if not actors:
        raise SystemExit("RAVDESS Actor_01 folder not found under /kaggle/input")
    return os.path.dirname(actors[0])


sh(["nvidia-smi"], check=False)
sh(["git", "clone", "-q", REPO, CODE])
sh(["git", "-C", CODE, "checkout", "-q", COMMIT])
sh([sys.executable, "-m", "pip", "install", "-q", "timm", "soundfile"], check=False)
os.chdir(CODE)

failed = []
voice_manifest = f"{WORK}/voice_manifest.csv"
for job in JOBS:
    out = f"{WORK}/out/{job['name']}"
    if job["kind"] == "face":
        cmd = [sys.executable, "training/train_face.py", "--data-dir", face_dir(), "--out-dir", out]
    else:
        if not os.path.exists(voice_manifest):
            sh([sys.executable, "training/prepare_voice.py", "--audio-dir", voice_dir(), "--out", voice_manifest])
        cmd = [sys.executable, "training/train_voice.py", "--audio-dir", voice_dir(), "--manifest", voice_manifest,
               "--out-dir", out]
    if sh(cmd + job["args"], check=False) != 0:
        failed.append(job["name"])

print("FAILED JOBS:", failed or "none", flush=True)
sys.exit(1 if failed else 0)
