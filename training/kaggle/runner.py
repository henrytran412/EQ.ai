"""Run training jobs on Kaggle: face and voice in parallel lanes, one GPU each.

Kaggle gives 2x T4; running everything on GPU 0 left the second idle. Each lane runs its jobs in
order with CUDA_VISIBLE_DEVICES set to its own GPU, and every output line is prefixed with the
job name so the interleaved log stays readable. Called by run_template.py after cloning:
  python training/kaggle/runner.py --jobs '[{"kind": "face", "name": "face_convnext", "args": []}]'
"""

import argparse
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parents[2]


def plan_lanes(jobs: list[dict], n_gpus: int) -> list[list[dict]]:
    """Two or more GPUs: one lane for face jobs and one for voice jobs. One GPU: everything in order."""
    if n_gpus < 2:
        return [list(jobs)] if jobs else []
    lanes = [[j for j in jobs if j["kind"] == kind] for kind in ("face", "voice")]
    return [lane for lane in lanes if lane]


def run_lanes(lanes: list[list[dict]], build_cmd: Callable[[dict], list[str]]) -> list[str]:
    """Run the lanes at the same time (lane i on GPU i). Returns names of jobs that exited non-zero."""
    failed, lock = [], threading.Lock()

    def run_lane(gpu: int, lane: list[dict]) -> None:
        env = {**os.environ, "CUDA_VISIBLE_DEVICES": str(gpu), "PYTHONUNBUFFERED": "1"}
        for job in lane:
            proc = subprocess.Popen(build_cmd(job), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
                                    text=True, encoding="utf-8", errors="replace")
            for line in proc.stdout:
                print(f"[{job['name']}] {line}", end="", flush=True)
            if proc.wait() != 0:
                with lock:
                    failed.append(job["name"])

    threads = [threading.Thread(target=run_lane, args=(gpu, lane)) for gpu, lane in enumerate(lanes)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return failed


def find_face_dir(root: Path) -> Path:
    for manifest in sorted(root.rglob("manifest.csv")):
        if (manifest.parent / "train").is_dir():
            return manifest.parent
    raise SystemExit(f"face dataset (manifest.csv + train/) not found under {root}")


def find_voice_dir(root: Path) -> Path:
    actors = sorted((p for p in root.rglob("Actor_01") if p.is_dir()), key=lambda p: len(p.parts))
    if not actors:
        raise SystemExit(f"RAVDESS Actor_01 folder not found under {root}")
    return actors[0].parent  # the top-level copy; prepare_voice skips the duplicate folder


def count_gpus() -> int:
    try:
        listing = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return 1
    return max(1, sum(line.startswith("GPU ") for line in listing.splitlines()))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--jobs", required=True, help="JSON list of {kind, name, args}")
    p.add_argument("--input", type=Path, default=Path("/kaggle/input"))
    p.add_argument("--work", type=Path, default=Path("/kaggle/working"))
    args = p.parse_args()
    jobs = json.loads(args.jobs)
    kinds = {j["kind"] for j in jobs}
    face_dir = find_face_dir(args.input) if "face" in kinds else None
    voice_dir = find_voice_dir(args.input) if "voice" in kinds else None
    manifest = args.work / "voice_manifest.csv"
    if voice_dir:
        subprocess.run([sys.executable, str(REPO / "training" / "prepare_voice.py"), "--audio-dir", str(voice_dir),
                        "--out", str(manifest)], check=True)

    def build(job: dict) -> list[str]:
        out = str(args.work / "out" / job["name"])
        if job["kind"] == "face":
            return [sys.executable, str(REPO / "training" / "train_face.py"), "--data-dir", str(face_dir),
                    "--out-dir", out, *job["args"]]
        return [sys.executable, str(REPO / "training" / "train_voice.py"), "--audio-dir", str(voice_dir),
                "--manifest", str(manifest), "--out-dir", out, *job["args"]]

    lanes = plan_lanes(jobs, count_gpus())
    for gpu, lane in enumerate(lanes):
        print(f"GPU {gpu}: {' -> '.join(j['name'] for j in lane)}", flush=True)
    failed = run_lanes(lanes, build)
    print("FAILED JOBS:", failed or "none", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
