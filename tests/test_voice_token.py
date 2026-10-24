"""POST /voice/token: short-lived Cartesia token so the browser never sees the API key."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_WEB = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx", "anthropic"))


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class VoiceToken(unittest.TestCase):
    def make_client(self, minter):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        return TestClient(create_app(model=object(), knowledge_dir=Path(self.tmp.name),
                                     allowed_origins=["http://localhost:5173"], token_minter=minter))

    def test_token_and_voice_settings_are_returned(self):
        calls = []

        def minter(grants, expires_in):
            calls.append((grants, expires_in))
            return "short-lived-token"

        body = self.make_client(minter).post("/voice/token").json()
        self.assertEqual(body["token"], "short-lived-token")
        self.assertEqual(calls, [({"tts": True, "stt": True}, 600)])
        self.assertLessEqual(body["expires_in"], 3600)
        self.assertEqual(body["tts"]["model_id"], "sonic-3.6")
        self.assertTrue(body["tts"]["voice_id"])
        self.assertEqual(body["stt"]["sample_rate"], 16000)
        self.assertIn("cartesia_version", body)

    def test_missing_cartesia_key_gives_clear_503(self):
        from services.dialogue.app import CartesiaNotConfigured

        def minter(grants, expires_in):
            raise CartesiaNotConfigured("CARTESIA_API_KEY is not set")

        r = self.make_client(minter).post("/voice/token")
        self.assertEqual(r.status_code, 503)
        self.assertIn("CARTESIA_API_KEY", r.json()["detail"])

    def test_cartesia_outage_gives_502_not_a_crash(self):
        def minter(grants, expires_in):
            raise ConnectionError("cartesia unreachable")

        self.assertEqual(self.make_client(minter).post("/voice/token").status_code, 502)


if __name__ == "__main__":
    unittest.main()
