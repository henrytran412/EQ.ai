"""Per-visitor rate limits on the paid endpoints (/chat calls Claude, /voice/token unlocks Cartesia)."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAS_WEB = all(importlib.util.find_spec(m) for m in ("fastapi", "httpx", "anthropic"))


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class RateLimiterWindow(unittest.TestCase):
    def test_allows_limit_then_blocks_until_window_passes(self):
        from services.dialogue.app import RateLimiter
        now = [0.0]
        rl = RateLimiter(limit=2, window=60, clock=lambda: now[0])
        self.assertTrue(rl.allow("a"))
        self.assertTrue(rl.allow("a"))
        self.assertFalse(rl.allow("a"))
        self.assertTrue(rl.allow("b"))  # other visitors are not affected
        now[0] = 60.0
        self.assertTrue(rl.allow("a"))


@unittest.skipUnless(HAS_WEB, "fastapi/httpx/anthropic not installed")
class RateLimitedEndpoints(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from services.dialogue.app import create_app
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        app = create_app(model=object(), knowledge_dir=Path(self.tmp.name), allowed_origins=["http://localhost:5173"],
                         token_minter=lambda grants, expires_in: "tok", chat_limit=(2, 600), token_limit=(1, 600))
        self.client = TestClient(app)

    def chat(self, ip):
        return self.client.post("/chat", headers={"CF-Connecting-IP": ip},
                                json={"session_id": "s1", "topic": "other", "text": "hi"})

    def test_chat_is_limited_per_visitor_ip(self):
        self.assertEqual(self.chat("1.1.1.1").status_code, 200)
        self.assertEqual(self.chat("1.1.1.1").status_code, 200)
        blocked = self.chat("1.1.1.1")
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Retry-After", blocked.headers)
        self.assertEqual(self.chat("2.2.2.2").status_code, 200)

    def test_voice_token_is_limited(self):
        ip = {"CF-Connecting-IP": "1.1.1.1"}
        self.assertEqual(self.client.post("/voice/token", headers=ip).status_code, 200)
        self.assertEqual(self.client.post("/voice/token", headers=ip).status_code, 429)


if __name__ == "__main__":
    unittest.main()
