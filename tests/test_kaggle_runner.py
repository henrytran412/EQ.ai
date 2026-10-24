"""Kaggle job runner: face and voice jobs in parallel on separate GPUs, failures reported."""

import contextlib
import io
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training" / "kaggle"))

from runner import find_face_dir, find_voice_dir, plan_lanes, run_lanes  # noqa: E402

FACE1 = {"kind": "face", "name": "face_convnext", "args": []}
VOICE1 = {"kind": "voice", "name": "voice_mel", "args": []}
VOICE2 = {"kind": "voice", "name": "voice_wavlm", "args": []}


class Lanes(unittest.TestCase):
    def test_two_gpus_put_face_and_voice_in_separate_lanes(self):
        self.assertEqual(plan_lanes([FACE1, VOICE1, VOICE2], n_gpus=2), [[FACE1], [VOICE1, VOICE2]])

    def test_one_gpu_runs_everything_in_order_in_one_lane(self):
        self.assertEqual(plan_lanes([VOICE1, FACE1, VOICE2], n_gpus=1), [[VOICE1, FACE1, VOICE2]])

    def test_only_one_kind_uses_one_lane(self):
        self.assertEqual(plan_lanes([VOICE1, VOICE2], n_gpus=2), [[VOICE1, VOICE2]])


class RunLanes(unittest.TestCase):
    def run_quietly(self, lanes, build_cmd):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            start = time.monotonic()
            failed = run_lanes(lanes, build_cmd)
            elapsed = time.monotonic() - start
        return failed, elapsed, out.getvalue()

    def test_lanes_run_at_the_same_time(self):
        sleep = [sys.executable, "-c", "import time; time.sleep(1.5)"]
        failed, elapsed, _ = self.run_quietly([[FACE1], [VOICE1]], lambda job: sleep)
        self.assertEqual(failed, [])
        self.assertLess(elapsed, 2.8)  # sequential would take 3 s or more

    def test_each_lane_sees_only_its_own_gpu_and_output_is_labelled(self):
        show = [sys.executable, "-c", "import os; print(os.environ['CUDA_VISIBLE_DEVICES'])"]
        _, _, text = self.run_quietly([[FACE1], [VOICE1]], lambda job: show)
        self.assertIn("[face_convnext] 0", text)
        self.assertIn("[voice_mel] 1", text)

    def test_a_failed_job_is_reported_and_the_lane_continues(self):
        def build(job):
            code = "raise SystemExit(3)" if job["name"] == "voice_mel" else "print('ok')"
            return [sys.executable, "-c", code]
        failed, _, text = self.run_quietly([[VOICE1, VOICE2]], build)
        self.assertEqual(failed, ["voice_mel"])
        self.assertIn("[voice_wavlm] ok", text)


class DataDiscovery(unittest.TestCase):
    def test_finds_face_folder_with_manifest_and_train_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            face = Path(tmp) / "datasets" / "me" / "faces"
            (face / "train").mkdir(parents=True)
            (face / "manifest.csv").write_text("path,split,label\n")
            (Path(tmp) / "other").mkdir()
            (Path(tmp) / "other" / "manifest.csv").write_text("x\n")  # no train/: not the face set
            self.assertEqual(find_face_dir(Path(tmp)), face)

    def test_finds_top_level_ravdess_folder_not_the_duplicate_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "ravdess"
            (root / "Actor_01").mkdir(parents=True)
            (root / "audio_speech_actors_01-24" / "Actor_01").mkdir(parents=True)
            self.assertEqual(find_voice_dir(Path(tmp)), root)

    def test_missing_dataset_fails_with_a_clear_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(SystemExit, "face dataset"):
                find_face_dir(Path(tmp))
            with self.assertRaisesRegex(SystemExit, "RAVDESS"):
                find_voice_dir(Path(tmp))


if __name__ == "__main__":
    unittest.main()
