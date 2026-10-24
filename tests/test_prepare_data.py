"""Checks for the dataset cleaning rules. Run: python -m unittest discover -s tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "training"))

from prepare_face import attach_labels, dedupe, dhash, resplit, split_for  # noqa: E402
from prepare_voice import actor_split, build_rows, parse_name  # noqa: E402


def img(split, key, md5):
    return {"path": f"{split}/{key}", "split": split, "key": key.lower(),
            "folder_label": key.split("/")[0].lower(), "md5": md5}


class FaceCleaning(unittest.TestCase):
    def test_contempt_and_missing_labels_are_dropped(self):
        images = [img("train", "anger/a.jpg", "1"), img("train", "happy/b.jpg", "2"), img("val", "sad/c.jpg", "3")]
        rows = [{"pth": "anger/a.jpg", "label": "surprise", "relFCs": "0.8"},
                {"pth": "happy/b.jpg", "label": "contempt", "relFCs": "0.7"}]
        dropped = attach_labels(images, rows)
        self.assertEqual(images[0]["label"], "surprise")  # labels.csv wins over the folder
        self.assertNotIn("label", images[1])
        self.assertNotIn("label", images[2])
        self.assertEqual(dropped["label contempt"], 1)
        self.assertEqual(dropped["no labels.csv row"], 1)

    def test_same_path_with_different_pixels_is_ambiguous(self):
        images = [img("train", "fear/x.jpg", "1"), img("test", "fear/x.jpg", "2")]
        dropped = attach_labels(images, [{"pth": "fear/x.jpg", "label": "fear", "relFCs": ""}])
        self.assertTrue(all("label" not in i for i in images))
        self.assertEqual(dropped["same path, different pixels across splits"], 2)

    def test_identical_copies_keep_train_copy_only(self):
        a, b = img("test", "anger/t.jpg", "same"), img("train", "anger/r.jpg", "same")
        a["label"] = b["label"] = "anger"
        kept, dropped = dedupe([a, b])
        self.assertEqual([k["split"] for k in kept], ["train"])
        self.assertEqual(dropped["duplicate copy"], 1)

    def test_identical_copies_with_conflicting_labels_are_dropped(self):
        a, b = img("train", "anger/t.jpg", "same"), img("train", "sad/r.jpg", "same")
        a["label"], b["label"] = "anger", "sad"
        kept, dropped = dedupe([a, b])
        self.assertEqual(kept, [])
        self.assertEqual(dropped["identical image, conflicting labels"], 2)


class FaceResplit(unittest.TestCase):
    """AffectNet's own test/sad folder is entirely copies of train/val, so the pool is re-split."""

    def test_split_is_deterministic_and_close_to_80_10_10(self):
        keys = [f"{i:016x}" for i in range(20000)]
        splits = [split_for(k) for k in keys]
        self.assertEqual(splits, [split_for(k) for k in keys])
        for name, share in (("train", 0.8), ("val", 0.1), ("test", 0.1)):
            self.assertAlmostEqual(splits.count(name) / len(keys), share, delta=0.02)

    def test_near_duplicates_land_in_the_same_split(self):
        a, b = img("train", "anger/a.jpg", "1"), img("test", "anger/b.jpg", "2")
        a["group"] = b["group"] = "same-dhash"
        a["label"] = b["label"] = "anger"
        out = resplit([a, b])
        self.assertEqual(out[0]["split"], out[1]["split"])
        self.assertEqual((out[0]["orig_split"], out[1]["orig_split"]), ("train", "test"))

    def test_dhash_ignores_re_encoding_but_tells_faces_apart(self):
        import io
        import random
        from PIL import Image
        rng = random.Random(0)
        def picture(up, start):  # 9x8 coarse structure with clear steps, like real facial features
            grid = []
            for _ in range(8):
                row = [start]
                for i in range(8):  # steps of 40-60 that never clip at 0 or 255
                    row.append(row[-1] + (1 if up(i) else -1) * rng.randrange(40, 60))
                grid += row
            img = Image.new("L", (9, 8))
            img.putdata(grid)
            return img.resize((96, 96), Image.BILINEAR).convert("RGB")

        face = picture(lambda i: i % 2 == 0, 100)
        other = picture(lambda i: i % 3 == 0, 230)
        buf = io.BytesIO()
        face.save(buf, "JPEG", quality=60)
        re_encoded = Image.open(io.BytesIO(buf.getvalue()))
        self.assertEqual(dhash(face), dhash(re_encoded))
        self.assertNotEqual(dhash(face), dhash(other))


class VoiceCleaning(unittest.TestCase):
    def test_parse_maps_emotion_and_actor(self):
        self.assertEqual(parse_name("03-01-05-02-01-01-12.wav"),
                         {"label": "anger", "actor": 12, "intensity": "strong", "gender": "female"})

    def test_calm_and_song_are_skipped(self):
        self.assertIsNone(parse_name("03-01-02-01-01-01-01.wav"))  # calm
        self.assertIsNone(parse_name("03-02-03-01-01-01-01.wav"))  # song channel
        self.assertIsNone(parse_name("notes.wav"))

    def test_clip_stored_twice_is_kept_once(self):
        # Kaggle's RAVDESS zip holds every clip under Actor_XX/ and audio_speech_actors_01-24/Actor_XX/
        root = Path("ravdess")
        clip = "03-01-05-02-01-01-12.wav"
        rows, skipped = build_rows([root / "Actor_12" / clip,
                                    root / "audio_speech_actors_01-24" / "Actor_12" / clip,
                                    root / "Actor_12" / "03-01-02-01-01-01-12.wav"], root)
        self.assertEqual([r["path"] for r in rows], [f"Actor_12/{clip}"])
        self.assertEqual(rows[0]["split"], "train")
        self.assertEqual(skipped, 1)  # the calm clip; the duplicate is not counted as skipped

    def test_actor_split_never_mixes_speakers(self):
        self.assertEqual({actor_split(a) for a in range(1, 19)}, {"train"})
        self.assertEqual([actor_split(a) for a in (19, 20)], ["val", "val"])
        self.assertEqual({actor_split(a) for a in range(21, 25)}, {"test"})


if __name__ == "__main__":
    unittest.main()
