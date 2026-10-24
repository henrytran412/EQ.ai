"""POST /handoff: the advisor's summary of the student's problem (Claude, with a safe fallback)."""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_WEB = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx", "anthropic"))

HISTORY = [
    {"role": "student", "text": "I have a financial aid hold and I can't register."},
    {"role": "assistant", "text": "Check the To Do list in MySJSU for a missing document."},
    {"role": "student", "text": "I uploaded the form already. The deadline is Friday."},
]


def handoff_body(**overrides):
    body = {"session_id": "s1", "topic": "financial_aid_hold", "history": HISTORY}
    body.update(overrides)
    return body


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class HandoffApi(unittest.TestCase):
    def client(self, model, chat_limit=(20, 600)):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return TestClient(create_app(model=model, knowledge_dir=Path(tmp.name), allowed_origins=["http://localhost:5173"],
                                     chat_limit=chat_limit))

    def test_claude_summary_is_returned(self):
        from services.dialogue.llm import HandoffSummary
        seen = {}

        class Model:
            def summarize(self, topic, history):
                seen["topic"], seen["history"] = topic, history
                return HandoffSummary(problem="A financial aid hold blocks registration.", deadline="Friday",
                                      tried=["Uploaded the requested form"], next_step="Check the To Do list item.")

        body = self.client(Model()).post("/handoff", json=handoff_body()).json()
        self.assertEqual(body["source"], "claude")
        self.assertEqual(body["summary"]["deadline"], "Friday")
        self.assertEqual(body["summary"]["tried"], ["Uploaded the requested form"])
        self.assertEqual(seen["topic"], "financial_aid_hold")
        self.assertEqual([t.text for t in seen["history"]], [t["text"] for t in HISTORY])

    def test_model_failure_falls_back_to_the_students_own_words(self):
        class Broken:
            def summarize(self, topic, history):
                raise RuntimeError("Claude is down")

        body = self.client(Broken()).post("/handoff", json=handoff_body()).json()
        self.assertEqual(body["source"], "fallback")
        self.assertIn("The deadline is Friday.", body["summary"]["problem"])
        self.assertNotIn("To Do list", body["summary"]["problem"])  # only the student's words, not the assistant's
        self.assertIsNone(body["summary"]["deadline"])

    def test_no_student_messages_skips_claude(self):
        calls = []

        class Model:
            def summarize(self, topic, history):
                calls.append(topic)

        body = self.client(Model()).post("/handoff", json=handoff_body(history=[])).json()
        self.assertEqual(calls, [])
        self.assertEqual(body["source"], "fallback")
        self.assertIn("hasn't described", body["summary"]["problem"])

    def test_shares_the_chat_rate_limit(self):
        client = self.client(object(), chat_limit=(1, 600))
        self.assertEqual(client.post("/handoff", json=handoff_body()).status_code, 200)
        self.assertEqual(client.post("/handoff", json=handoff_body()).status_code, 429)

    def test_rejects_oversized_history(self):
        client = self.client(object())
        too_long = [{"role": "student", "text": "x"}] * 41
        self.assertEqual(client.post("/handoff", json=handoff_body(history=too_long)).status_code, 422)


def fake_anthropic(reply_text: str, stop_reason: str = "end_turn"):
    sent = {}

    class Messages:
        def create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(stop_reason=stop_reason, _request_id="req_1",
                                   content=[SimpleNamespace(type="text", text=reply_text)])

    return SimpleNamespace(messages=Messages(), beta=SimpleNamespace(messages=Messages())), sent


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class ClaudeCalls(unittest.TestCase):
    def turns(self):
        from services.dialogue.app import Turn
        return [Turn(**t) for t in HISTORY]

    def test_summary_is_parsed_and_gets_no_emotion_signals(self):
        from services.dialogue.llm import ClaudeDialogue
        out = {"problem": "Hold blocks registration.", "deadline": "Friday", "tried": [], "next_step": "Check To Do list."}
        client, sent = fake_anthropic(json.dumps(out))
        summary = ClaudeDialogue(client=client, model="claude-opus-5-5").summarize("financial_aid_hold", self.turns())
        self.assertEqual(summary.model_dump(), out)
        prompt = sent["messages"][0]["content"]
        self.assertIn("The deadline is Friday.", prompt)
        self.assertNotIn("SIGNALS", prompt)  # emotion estimates reach staff only with the student's consent
        self.assertEqual(sent["output_config"]["format"]["type"], "json_schema")

    def test_refusal_or_bad_json_gives_none(self):
        from services.dialogue.llm import ClaudeDialogue
        for text, stop in (('{"problem": "x"}', "refusal"), ("not json", "end_turn")):
            client, _ = fake_anthropic(text, stop)
            self.assertIsNone(ClaudeDialogue(client=client, model="claude-opus-5-5").summarize("other", self.turns()))

    def test_turn_reply_still_parses(self):
        from services.dialogue.app import ChatRequest
        from services.dialogue.llm import ClaudeDialogue
        out = {"state": "confused", "confidence": 0.7, "evidence": ["text"], "reply": "Let me explain it simply.",
               "cited_ids": [], "uncertainty": None}
        client, sent = fake_anthropic(json.dumps(out))
        # Claude Code exports CLAUDE_EFFORT (e.g. "max") into shells; it must not change the reply effort.
        env = {k: v for k, v in os.environ.items() if k != "DIALOGUE_EFFORT"} | {"CLAUDE_EFFORT": "max"}
        with mock.patch.dict(os.environ, env, clear=True):
            turn = ClaudeDialogue(client=client, model="claude-opus-5-5").respond(
                ChatRequest(session_id="s", topic="other", text="I don't get it"), [], None)
        self.assertEqual(turn.state, "confused")
        self.assertEqual(sent["output_config"]["effort"], "low")
        self.assertEqual(sent["fallbacks"], "default")


if __name__ == "__main__":
    unittest.main()
