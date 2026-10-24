"""Compare finished training runs: one table, winner per kind chosen on VAL macro F1.

Test scores are reported but never used to pick a model, so they stay an honest estimate.
Usage: python training/compare_runs.py training/runs/run1   (folder with face_*/ and voice_*/ runs)
Writes COMPARISON.md next to the runs.
"""

import json
import sys
from pathlib import Path


def compare(root: Path) -> dict:
    rows, missing = [], []
    for run in sorted(p for p in root.iterdir() if p.is_dir()):
        metrics_file = run / "metrics.json"
        if not metrics_file.is_file():
            missing.append(run.name)
            continue
        m = json.loads(metrics_file.read_text())
        rows.append({"name": run.name, "kind": run.name.split("_")[0], "val_f1": m["val_best"]["macro_f1"],
                     "test_f1": m["test"]["macro_f1"], "test_acc": m["test"]["accuracy"],
                     "per_class": {c: v["f1"] for c, v in m["test"]["per_class"].items()}})

    winners = {}
    for row in rows:
        best = winners.get(row["kind"])
        if best is None or row["val_f1"] > best["val_f1"]:
            winners[row["kind"]] = row
    labels = sorted({c for r in rows for c in r["per_class"]})
    lines = ["| run | val macro-F1 | test macro-F1 | test accuracy |", "|---|---|---|---|"]
    lines += [f"| {r['name']} | {r['val_f1']:.3f} | {r['test_f1']:.3f} | {r['test_acc']:.3f} |" for r in rows]
    lines += ["", "Test F1 per emotion:", "", "| run | " + " | ".join(labels) + " |",
              "|---|" + "---|" * len(labels)]
    lines += [f"| {r['name']} | " + " | ".join(f"{r['per_class'].get(c, 0):.2f}" for c in labels) + " |"
              for r in rows]
    return {"table": "\n".join(lines), "winners": {k: v["name"] for k, v in winners.items()},
            "missing": missing}


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "training/runs")
    report = compare(root)
    text = (report["table"] + "\n\nWinner per kind (by val macro-F1): "
            + ", ".join(f"{k}: {v}" for k, v in report["winners"].items())
            + ("\nRuns without metrics (failed?): " + ", ".join(report["missing"]) if report["missing"] else ""))
    (root / "COMPARISON.md").write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
