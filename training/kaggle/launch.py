"""Push training jobs to Kaggle as one private GPU kernel run.

Usage (from the repo root, after committing and pushing to GitHub):
  .venv/Scripts/python training/kaggle/launch.py "face:face_mnv3:--model mobilenetv3_large_100" \
      "voice:voice_wavlm:--arch wavlm"
Each job is kind:name:args. Kaggle clones this repo at the current commit, so local
changes must be pushed first, unless --local-snapshot is passed. That option embeds
only training Python source in the private kernel and records its SHA256 in outputs.
Then:
  .venv/Scripts/kaggle kernels status henrytran412/eq-ai-train
  .venv/Scripts/kaggle kernels output henrytran412/eq-ai-train -p training/runs/<run>
"""

import json
import argparse
import hashlib
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
KAGGLE = Path(sys.executable).parent / "kaggle"


def parse_job(spec: str) -> dict:
    kind, name, args = (spec.split(":", 2) + [""])[:3]
    if kind not in ("face", "voice") or not name:
        raise SystemExit(f"bad job {spec!r}; expected face|voice:name:args")
    return {"kind": kind, "name": name, "args": shlex.split(args)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-snapshot', action='store_true', help='Embed training source only; no GitHub push needed')
    parser.add_argument('jobs', nargs='+')
    args = parser.parse_args()
    jobs = [parse_job(s) for s in args.jobs]
    if not jobs:
        raise SystemExit(__doc__)
    git = lambda *a: subprocess.run(["git", *a], check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    commit = git("rev-parse", "HEAD")
    snapshot = {}
    if args.local_snapshot:
        root = HERE.resolve().parents[1]
        paths = sorted((root / 'training').glob('*.py')) + [HERE.resolve() / 'runner.py']
        snapshot = {p.relative_to(root).as_posix(): p.read_text(encoding='utf-8') for p in paths}
        digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
        print(f'Training source snapshot SHA256: {digest}', flush=True)
    else:
        git("fetch", "-q", "origin")
        if git("branch", "-r", "--contains", commit) == "":
            raise SystemExit(f"commit {commit[:7]} is not on GitHub yet; push first (Kaggle clones from GitHub)")

    source = (HERE / "run_template.py").read_text(encoding="utf-8")
    source = source.replace('"__COMMIT__"', json.dumps(commit)).replace("__JOBS__", json.dumps(jobs))
    source = source.replace('__SNAPSHOT__', repr(snapshot))
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "run.py").write_text(source, encoding="utf-8")
        (Path(tmp) / "kernel-metadata.json").write_text((HERE / "kernel-metadata.json").read_text(encoding="utf-8"),
                                                        encoding="utf-8")
        subprocess.run([str(KAGGLE), "kernels", "push", "-p", tmp, "--accelerator", "NvidiaTeslaT4"], check=True)
    print(f"pushed commit {commit[:7]} with jobs: {', '.join(j['name'] for j in jobs)}")


if __name__ == "__main__":
    main()
