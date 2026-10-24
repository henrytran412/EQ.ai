"""Retrieval over cached official school pages."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.dialogue.retrieval import KnowledgeBase  # noqa: E402

AID_PAGE = """---
title: Financial Aid Holds
url: https://example.edu/aid/holds
---
A financial aid hold blocks registration until missing documents are submitted.

Submit the verification worksheet through the student portal to clear the hold.
"""
PARKING_PAGE = """---
title: Parking Permits
url: https://example.edu/parking
---
Semester parking permits are sold online before classes start.
"""


class Retrieval(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "aid-holds.md").write_text(AID_PAGE, encoding="utf-8")
        (root / "parking.md").write_text(PARKING_PAGE, encoding="utf-8")
        self.kb = KnowledgeBase.load(root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_pages_are_split_into_paragraph_passages_with_source(self):
        self.assertEqual(len(self.kb.passages), 3)
        first = self.kb.passages[0]
        self.assertEqual((first.title, first.url), ("Financial Aid Holds", "https://example.edu/aid/holds"))

    def test_relevant_page_ranks_first(self):
        hits = self.kb.search("why can't I register, I have a financial aid hold", k=2)
        self.assertEqual(hits[0].title, "Financial Aid Holds")

    def test_unrelated_query_returns_nothing(self):
        self.assertEqual(self.kb.search("visa interview appointment", k=3), [])

    def test_passage_ids_are_unique_and_stable(self):
        ids = [p.id for p in self.kb.passages]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, [p.id for p in KnowledgeBase.load(Path(self.tmp.name)).passages])

    def test_empty_folder_gives_empty_knowledge(self):
        with tempfile.TemporaryDirectory() as empty:
            self.assertEqual(KnowledgeBase.load(Path(empty)).search("hold", k=3), [])


if __name__ == "__main__":
    unittest.main()
