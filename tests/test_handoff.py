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


STAFF = {"Authorization": "Bearer staff-code-1"}


class NoteModel:
    def summarize(self, topic, history):
        from services.dialogue.llm import HandoffSummary
        return HandoffSummary(problem="A financial aid hold blocks registration.", deadline="Friday",
                              tried=["Uploaded the requested form"], next_step="Check the To Do list item.")


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class HandoffApi(unittest.TestCase):
    def client(self, model, chat_limit=(20, 600), staff_code="staff-code-1"):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return TestClient(create_app(model=model, knowledge_dir=Path(tmp.name), allowed_origins=["http://localhost:5173"],
                                     chat_limit=chat_limit, handoff_db=":memory:", staff_code=staff_code))

    def test_claude_summary_is_returned(self):
        from services.dialogue.llm import HandoffSummary
        seen = {}

        class Model:
            def summarize(self, topic, history):
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
            def summarize(self, topic, history):
                raise RuntimeError("Claude is down")

        body = self.client(Broken()).post("/handoffs", json=handoff_body()).json()
        self.assertEqual(body["note_source"], "fallback")
        self.assertIn("The deadline is Friday.", body["note"]["problem"])
        self.assertNotIn("To Do list", body["note"]["problem"])  # only the student's words, not the assistant's
        self.assertIsNone(body["note"]["deadline"])
        self.assertEqual(body["status"], "waiting")  # the handoff still goes through

    def test_no_student_messages_skips_claude(self):
        calls = []

        class Model:
            def summarize(self, topic, history):
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

    def test_stored_handoff_reaches_the_students_page_and_the_advisor(self):
        client = self.client(NoteModel())
        h = client.post("/handoffs", json=handoff_body()).json()
        self.assertGreaterEqual(len(h["id"]), 20)  # random, unguessable
        self.assertEqual(client.get(f"/handoffs/{h['id']}").json(), h)
        listed = client.get("/handoffs", headers=STAFF).json()["handoffs"]
        self.assertEqual([x["id"] for x in listed], [h["id"]])
        self.assertEqual(listed[0]["transcript"], HISTORY)  # the advisor sees the whole chat with EQ.ai
        self.assertEqual(listed[0]["note"]["deadline"], "Friday")
        self.assertEqual(client.get("/handoffs/not-a-real-id").status_code, 404)

    def test_emotion_estimate_is_stored_only_when_the_student_shares_it(self):
        client = self.client(NoteModel())
        self.assertIsNone(client.post("/handoffs", json=handoff_body()).json()["emotion"])
        shared = client.post("/handoffs", json=handoff_body(emotion={"label": "frustrated", "confidence": 0.7})).json()
        self.assertEqual(shared["emotion"], {"label": "frustrated", "confidence": 0.7})

    def test_advisor_console_needs_the_access_code(self):
        client = self.client(NoteModel())
        self.assertEqual(client.get("/handoffs").status_code, 401)
        self.assertEqual(client.get("/handoffs", headers={"Authorization": "Bearer wrong"}).status_code, 401)
        self.assertEqual(client.get("/handoffs", headers=STAFF).status_code, 200)
        unset = self.client(NoteModel(), staff_code="")  # no STAFF_CODE: the console stays closed
        self.assertEqual(unset.get("/handoffs", headers=STAFF).status_code, 503)

    def test_advisor_takes_the_chat_replies_and_closes_it(self):
        client = self.client(NoteModel())
        hid = client.post("/handoffs", json=handoff_body()).json()["id"]
        self.assertEqual(client.post(f"/handoffs/{hid}/status", json={"status": "active"}).status_code, 401)
        taken = client.post(f"/handoffs/{hid}/status", json={"status": "active", "staff_id": "Advisor (demo)"},
                            headers=STAFF).json()
        self.assertEqual((taken["status"], taken["staff_id"]), ("active", "Advisor (demo)"))
        client.post(f"/handoffs/{hid}/messages", json={"text": "Hi Mai, I can see your hold."}, headers=STAFF)
        h = client.post(f"/handoffs/{hid}/messages", json={"text": "  Thank you!  "}).json()
        self.assertEqual([(m["from"], m["text"]) for m in h["messages"]],
                         [("staff", "Hi Mai, I can see your hold."), ("student", "Thank you!")])
        self.assertGreater(h["version"], taken["version"])  # pages keep the newest version
        closed = client.post(f"/handoffs/{hid}/status", json={"status": "resolved"}, headers=STAFF).json()
        self.assertEqual(closed["status"], "resolved")
        self.assertEqual(client.post(f"/handoffs/{hid}/messages", json={"text": "one more"}).status_code, 409)
        self.assertEqual(client.post(f"/handoffs/{hid}/messages", json={"text": "  "}).status_code, 422)


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
        self.assertEqual(store.all(), [])
        self.assertIsNone(store.add_message(hid, "student", "hello?"))


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
