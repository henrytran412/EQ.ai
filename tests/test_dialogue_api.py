"""/chat and /signals HTTP contract, with a fake model instead of the Claude API."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_WEB = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx", "anthropic"))

PAGE = """---
title: Financial Aid Holds
url: https://example.edu/aid/holds
---
A financial aid hold blocks registration until missing documents are submitted.
"""


def chat_body(**overrides):
    body = {"session_id": "s1", "topic": "financial_aid_hold", "text": "I have a financial aid hold",
            "history": [], "awaiting_confirmation": False}
    body.update(overrides)
    return body


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class ChatApi(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        from services.dialogue.llm import ModelTurn, PlainTurn

        class FakeModel:
            def __init__(self):
                self.turn = ModelTurn(state="neutral", confidence=0.9, evidence=["text"],
                                      reply="Submit the verification worksheet to clear the hold.",
                                      cited_ids=[], uncertainty=None)
                self.plain = PlainTurn(reply="Upload the documents on your To Do List.", cited_ids=[],
                                       uncertainty=None, crisis=False)
                self.calls = []

            def respond(self, request, passages, signals):
                self.calls.append({"request": request, "passages": passages, "signals": signals})
                if self.turn is not None and self.turn.cited_ids == ["FIRST"]:
                    self.turn.cited_ids = [passages[0].id, "made-up-id"]
                return self.turn

            def respond_plain(self, request, passages):
                self.calls.append({"plain": request, "passages": passages})
                if self.plain is not None and self.plain.cited_ids == ["FIRST"]:
                    self.plain.cited_ids = [passages[0].id, "made-up-id"]
                return self.plain

        self.tmp = tempfile.TemporaryDirectory()
        (Path(self.tmp.name) / "holds.md").write_text(PAGE, encoding="utf-8")
        self.model = FakeModel()
        self.client = TestClient(create_app(model=self.model, knowledge_dir=Path(self.tmp.name),
                                            allowed_origins=["http://localhost:5173"]))

    def tearDown(self):
        self.tmp.cleanup()

    def test_response_matches_the_web_contract(self):
        r = self.client.post("/chat", json=chat_body())
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"reply", "tone", "behavior", "timing"})
        self.assertIsInstance(body["timing"]["model_ms"], int)  # Claude's share of the reply time
        self.assertGreaterEqual(body["timing"]["model_ms"], 0)
        self.assertEqual(set(body["tone"]), {"state", "confidence", "ask_confirmation", "tts_params",
                                             "avatar_expression"})
        self.assertEqual(set(body["tone"]["tts_params"]), {"speed", "emotion"})
        self.assertEqual(set(body["behavior"]), {"mode", "offer_handoff"})
        self.assertEqual(body["behavior"]["mode"], "normal")

    def test_citations_come_from_retrieved_pages_only(self):
        from services.dialogue.llm import ModelTurn  # noqa: F401
        self.model.turn.cited_ids = ["FIRST"]  # fake cites the first passage plus an invented id
        body = self.client.post("/chat", json=chat_body()).json()
        self.assertEqual(body["reply"]["citations"],
                         [{"title": "Financial Aid Holds", "url": "https://example.edu/aid/holds"}])

    def test_distress_reply_always_includes_988(self):
        self.model.turn.state = "distress"
        body = self.client.post("/chat", json=chat_body(text="I can't do this anymore")).json()
        self.assertIn("988", body["reply"]["text"])
        self.assertEqual(body["behavior"]["mode"], "distress")
        self.assertTrue(body["behavior"]["offer_handoff"])

    def test_refusal_or_model_failure_falls_back_to_a_safe_handoff_offer(self):
        self.model.turn = None  # model gave no usable answer
        body = self.client.post("/chat", json=chat_body()).json()
        self.assertTrue(body["behavior"]["offer_handoff"])
        self.assertIn("advisor", body["reply"]["text"].lower())

    def test_invalid_input_is_rejected(self):
        self.assertEqual(self.client.post("/chat", json=chat_body(topic="taxes")).status_code, 422)
        self.assertEqual(self.client.post("/chat", json=chat_body(text="x" * 4001)).status_code, 422)
        self.assertEqual(self.client.post("/chat", json=chat_body(text="   ")).status_code, 422)

    def test_cors_allows_only_the_student_app(self):
        ok = self.client.options("/chat", headers={"Origin": "http://localhost:5173",
                                                   "Access-Control-Request-Method": "POST"})
        bad = self.client.options("/chat", headers={"Origin": "http://evil.example",
                                                    "Access-Control-Request-Method": "POST"})
        self.assertEqual(ok.headers.get("access-control-allow-origin"), "http://localhost:5173")
        self.assertIsNone(bad.headers.get("access-control-allow-origin"))

    def test_latest_jetson_signals_reach_the_model(self):
        r = self.client.post("/signals", json={"session_id": "s1", "face": {"label": "fear", "confidence": 0.7},
                                               "voice": None})
        self.assertEqual(r.status_code, 204)
        self.client.post("/chat", json=chat_body())
        self.assertEqual(self.model.calls[-1]["signals"]["face"]["label"], "fear")

    def test_plain_mode_answers_without_any_emotion_feature(self):
        self.model.turn.state = "frustrated"  # the normal path would ask "am I reading this right?"
        self.model.plain.cited_ids = ["FIRST"]
        r = self.client.post("/chat", json=chat_body(text="This is so frustrating!", plain=True))
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("plain", self.model.calls[-1])  # the plain model call, not the emotion-aware one
        self.assertEqual(set(body), {"reply", "tone", "behavior", "timing"})  # same contract as /chat
        self.assertEqual(body["reply"]["text"], "Upload the documents on your To Do List.")
        self.assertEqual(body["reply"]["citations"],
                         [{"title": "Financial Aid Holds", "url": "https://example.edu/aid/holds"}])
        self.assertEqual(body["tone"]["tts_params"], {"speed": 1.0, "emotion": "neutral"})
        self.assertEqual((body["tone"]["state"], body["tone"]["confidence"]), ("neutral", 0.0))
        self.assertFalse(body["tone"]["ask_confirmation"])
        self.assertEqual(body["behavior"], {"mode": "normal", "offer_handoff": False})

    def test_plain_mode_still_shows_988_in_a_crisis(self):
        self.model.plain.crisis = True
        body = self.client.post("/chat", json=chat_body(text="I want to die", plain=True)).json()
        self.assertIn("988", body["reply"]["text"])

    def test_plain_mode_model_failure_still_answers(self):
        self.model.plain = None
        r = self.client.post("/chat", json=chat_body(plain=True))
        self.assertEqual(r.status_code, 200)
        self.assertIn("try again", r.json()["reply"]["text"])
        self.assertFalse(r.json()["behavior"]["offer_handoff"])

    def test_signals_never_accept_raw_media(self):
        r = self.client.post("/signals", json={"session_id": "s1", "face": {"label": "fear", "confidence": 0.7},
                                               "frame_jpeg": "AAAA"})
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
