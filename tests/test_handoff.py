"""/handoffs: the advisor's case note (Claude, with a safe fallback), stored in SQLite for the advisor console."""

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
    body = {"session_id": "s1", "topic": "financial_aid_hold", "student_name": "Mai", "history": HISTORY}
    body.update(overrides)
    return body


MOODS = [{"turn": 0, "label": "neutral", "confidence": 0.6}, {"turn": 2, "label": "frustrated", "confidence": 0.75}]


class NoteModel:
    """Writes a mood summary every time, so the tests can check the service drops it when nothing was shared."""

    def __init__(self):
        self.timelines = []

    def summarize(self, topic, history, timeline=()):
        from services.dialogue.llm import HandoffSummary, HardMoment
        self.timelines.append(list(timeline))
        return HandoffSummary(problem="A financial aid hold blocks registration.", deadline="Friday",
                              tried=["Uploaded the requested form"], next_step="Check the To Do list item.",
                              mood="Seemed calm at first, then frustrated.",
                              hard_moments=[HardMoment(quote="I uploaded the form already", estimate="frustrated",
                                                       reason="The hold is still there after uploading.")])


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class HandoffApi(unittest.TestCase):
    def client(self, model, chat_limit=(20, 600)):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return TestClient(create_app(model=model, knowledge_dir=Path(tmp.name), allowed_origins=["http://localhost:5173"],
                                     chat_limit=chat_limit, handoff_db=":memory:"))

    def test_claude_summary_is_returned(self):
        from services.dialogue.llm import HandoffSummary
        seen = {}

        class Model:
            def summarize(self, topic, history, timeline=()):
                seen["topic"], seen["history"] = topic, history
                return HandoffSummary(problem="A financial aid hold blocks registration.", deadline="Friday",
                                      tried=["Uploaded the requested form"], next_step="Check the To Do list item.")

        body = self.client(Model()).post("/handoffs", json=handoff_body()).json()
        self.assertEqual(body["note_source"], "claude")
        self.assertEqual(body["note"]["deadline"], "Friday")
        self.assertEqual(body["note"]["tried"], ["Uploaded the requested form"])
        self.assertEqual(seen["topic"], "financial_aid_hold")
        self.assertEqual([t.text for t in seen["history"]], [t["text"] for t in HISTORY])

    def test_model_failure_falls_back_to_the_students_own_words(self):
        class Broken:
            def summarize(self, topic, history, timeline=()):
                raise RuntimeError("Claude is down")

        body = self.client(Broken()).post("/handoffs", json=handoff_body(timeline=MOODS)).json()
        self.assertEqual(body["note_source"], "fallback")
        self.assertIn("The deadline is Friday.", body["note"]["problem"])
        self.assertNotIn("To Do list", body["note"]["problem"])  # only the student's words, not the assistant's
        self.assertIsNone(body["note"]["deadline"])
        self.assertEqual((body["note"]["mood"], body["note"]["hard_moments"]), (None, []))
        self.assertEqual(body["timeline"], MOODS)  # the shared estimates still reach the advisor view

    def test_no_student_messages_skips_claude(self):
        calls = []

        class Model:
            def summarize(self, topic, history, timeline=()):
                calls.append(topic)

        body = self.client(Model()).post("/handoffs", json=handoff_body(history=[])).json()
        self.assertEqual(calls, [])
        self.assertEqual(body["note_source"], "fallback")
        self.assertIn("hasn't described", body["note"]["problem"])

    def test_shares_the_chat_rate_limit(self):
        client = self.client(object(), chat_limit=(1, 600))
        self.assertEqual(client.post("/handoffs", json=handoff_body()).status_code, 200)
        self.assertEqual(client.post("/handoffs", json=handoff_body()).status_code, 429)

    def test_rejects_oversized_history_and_blank_names(self):
        client = self.client(object())
        too_long = [{"role": "student", "text": "x"}] * 41
        self.assertEqual(client.post("/handoffs", json=handoff_body(history=too_long)).status_code, 422)
        self.assertEqual(client.post("/handoffs", json=handoff_body(student_name="  ")).status_code, 422)

    def test_advisor_view_loads_the_stored_handoff(self):
        client = self.client(NoteModel())
        h = client.post("/handoffs", json=handoff_body()).json()
        self.assertGreaterEqual(len(h["id"]), 20)  # random, unguessable
        self.assertEqual(client.get(f"/handoffs/{h['id']}").json(), h)
        self.assertEqual(h["transcript"], HISTORY)  # the advisor sees the whole chat with EQ.ai
        self.assertEqual(h["note"]["deadline"], "Friday")
        self.assertEqual(client.get("/handoffs/not-a-real-id").status_code, 404)

    def test_moods_reach_claude_and_the_advisor_only_when_shared(self):
        model = NoteModel()
        client = self.client(model)
        private = client.post("/handoffs", json=handoff_body()).json()
        self.assertEqual(model.timelines[-1], [])
        self.assertEqual(private["timeline"], [])
        self.assertEqual((private["note"]["mood"], private["note"]["hard_moments"]), (None, []))  # dropped in code
        shared = client.post("/handoffs", json=handoff_body(timeline=MOODS)).json()
        self.assertEqual([p.turn for p in model.timelines[-1]], [0, 2])
        self.assertEqual(shared["timeline"], MOODS)
        self.assertIn("frustrated", shared["note"]["mood"])
        self.assertEqual(shared["note"]["hard_moments"][0]["estimate"], "frustrated")

    def test_mood_points_must_belong_to_student_messages(self):
        client = self.client(NoteModel())
        wrong = [{"turn": 1, "label": "confused", "confidence": 0.5},  # message 1 is EQ.ai's
                 {"turn": 9, "label": "sad", "confidence": 0.5}]  # there is no message 9
        h = client.post("/handoffs", json=handoff_body(timeline=wrong)).json()
        self.assertEqual(h["timeline"], [])
        self.assertIsNone(h["note"]["mood"])
        bad = [{"turn": 0, "label": "neutral", "confidence": 2}]
        self.assertEqual(client.post("/handoffs", json=handoff_body(timeline=bad)).status_code, 422)


class HandoffStoreExpiry(unittest.TestCase):
    def test_handoffs_are_deleted_after_the_retention_time(self):
        from services.dialogue.handoffs import HandoffStore
        now = [1000.0]
        store = HandoffStore(":memory:", retention_sec=60, clock=lambda: now[0])
        hid = store.create({"student_name": "Mai"})["id"]
        now[0] += 59
        self.assertIsNotNone(store.get(hid))
        now[0] += 2
        self.assertIsNone(store.get(hid))


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
        out = {"problem": "Hold blocks registration.", "deadline": "Friday", "tried": [], "next_step": "Check To Do list.",
               "mood": None, "hard_moments": []}
        client, sent = fake_anthropic(json.dumps(out))
        summary = ClaudeDialogue(client=client, model="claude-opus-5-5").summarize("financial_aid_hold", self.turns())
        self.assertEqual(summary.model_dump(), out)
        prompt = sent["messages"][0]["content"]
        self.assertIn("The deadline is Friday.", prompt)
        self.assertNotIn("SIGNALS", prompt)  # raw face and voice signals never go to the summary
        self.assertNotIn("ESTIMATED MOODS", prompt)  # moods only when the student shares them
        self.assertEqual(sent["output_config"]["format"]["type"], "json_schema")

    def test_shared_moods_are_numbered_by_message(self):
        from services.dialogue.app import MoodPoint
        from services.dialogue.llm import ClaudeDialogue
        out = {"problem": "Hold.", "deadline": None, "tried": [], "next_step": "Check.", "mood": "Seemed frustrated.",
               "hard_moments": [{"quote": "I uploaded the form already", "estimate": "frustrated", "reason": "Still blocked."}]}
        client, sent = fake_anthropic(json.dumps(out))
        summary = ClaudeDialogue(client=client, model="claude-opus-5-5").summarize(
            "financial_aid_hold", self.turns(), [MoodPoint(**m) for m in MOODS])
        self.assertEqual(summary.hard_moments[0].reason, "Still blocked.")
        prompt = sent["messages"][0]["content"]
        self.assertIn("[2] student: I uploaded the form already.", prompt)
        self.assertIn("ESTIMATED MOODS", prompt)
        self.assertIn("[2] frustrated (75%)", prompt)

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

    def test_plain_turn_gets_the_plain_prompt_and_no_emotion_signals(self):
        from services.dialogue.app import ChatRequest
        from services.dialogue.llm import ClaudeDialogue
        out = {"reply": "Upload the documents on your To Do List.", "cited_ids": [], "uncertainty": None,
               "crisis": False}
        client, sent = fake_anthropic(json.dumps(out))
        turn = ClaudeDialogue(client=client, model="claude-opus-5-5").respond_plain(
            ChatRequest(session_id="s", topic="other", text="I don't get it", plain=True), [])
        self.assertEqual(turn.reply, out["reply"])
        self.assertIn("Emotion features are off", sent["system"][0]["text"])
        self.assertNotIn("SIGNALS", sent["messages"][0]["content"])
        self.assertNotIn("AWAITING_CONFIRMATION", sent["messages"][0]["content"])
        self.assertEqual(sent["output_config"]["format"]["schema"]["required"],
                         ["reply", "cited_ids", "uncertainty", "crisis"])


if __name__ == "__main__":
    unittest.main()
