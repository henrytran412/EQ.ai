"""Dialogue HTTP service: POST /chat and /handoff for the student web app, POST /signals for the Jetson.

Run from the repo root:
  .venv/Scripts/uvicorn services.dialogue.app:create_app --factory --port 8000 --env-file .env
Env: ANTHROPIC_API_KEY, CLAUDE_MODEL, DIALOGUE_EFFORT, ALLOWED_ORIGINS, CAMPUS_COUNSELING,
     CARTESIA_API_KEY, CARTESIA_VOICE_ID, CARTESIA_TTS_MODEL, CARTESIA_STT_MODEL, CHAT_LIMIT, TOKEN_LIMIT ("hits/seconds").
Public use: bind to 127.0.0.1 behind the Cloudflare tunnel, which sets CF-Connecting-IP.
"""

import logging
import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .policy import decide_behavior
from .retrieval import KnowledgeBase

log = logging.getLogger("dialogue")
REPO = Path(__file__).resolve().parents[2]
SIGNAL_TTL_SEC = 30  # older perception readings are ignored
CRISIS = ("If you are in crisis or thinking about harming yourself, you can call or text 988, the US "
          "Suicide and Crisis Lifeline, any time.")
FALLBACK_REPLY = ("I'm sorry, I can't answer that reliably right now. Would you like me to connect you "
                  "with an advisor who can help?")


CARTESIA_VERSION = "2026-08-14"
TOKEN_TTL_SEC = 600  # Cartesia allows up to 3600
DEFAULT_VOICE = "cbaf8084-f009-4838-a096-07ee2e6612b1"  # "Maya", listed by Cartesia as an Emotive voice
# Words speech-to-text should favor (Cartesia keyterm prompting): school names that sound like common words.
STT_KEYTERMS = ["MySJSU", "SJSU", "FASO", "Bursar", "ISSS", "FAFSA", "Spartan", "registration hold",
                "financial aid hold", "tuition fee deferral", "F-1"]


class CartesiaNotConfigured(RuntimeError):
    pass


def cartesia_minter(grants: dict, expires_in: int) -> str:
    """Mint a short-lived Cartesia access token; the browser uses it as ?access_token=."""
    import httpx
    key = os.environ.get("CARTESIA_API_KEY", "").strip()
    if not key:
        raise CartesiaNotConfigured("CARTESIA_API_KEY is not set on the server")
    r = httpx.post("https://api.cartesia.ai/access-token", timeout=10.0,
                   headers={"Authorization": f"Bearer {key}", "Cartesia-Version": CARTESIA_VERSION},
                   json={"grants": grants, "expires_in": expires_in})
    r.raise_for_status()
    return r.json()["token"]


class RateLimiter:
    """Allow `limit` hits per `window` seconds per key (sliding window)."""

    def __init__(self, limit: int, window: float, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.hits: dict[str, deque] = defaultdict(deque)  # shortcut: in memory, one process, never pruned
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = self.clock()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


def env_limit(name: str, default: str) -> tuple[int, float]:
    hits, seconds = os.environ.get(name, default).split("/")
    return int(hits), float(seconds)


Topic = Literal["financial_aid_hold", "scholarships", "visa_status", "other"]


class Turn(BaseModel):
    role: Literal["student", "assistant"]
    text: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    topic: Topic
    text: str = Field(max_length=4000)
    history: list[Turn] = Field(default_factory=list, max_length=40)
    awaiting_confirmation: bool = False

    @field_validator("text")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text is empty")
        return v.strip()


class HandoffRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    topic: Topic
    history: list[Turn] = Field(default_factory=list, max_length=40)


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(max_length=20)
    confidence: float = Field(ge=0, le=1)


class Signals(BaseModel):
    """Classifier outputs only. Extra fields (e.g. image or audio data) are rejected."""
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(min_length=1, max_length=100)
    face: Reading | None = None
    voice: Reading | None = None


def create_app(model=None, knowledge_dir: Path | None = None, allowed_origins: list[str] | None = None,
               token_minter=cartesia_minter, chat_limit: tuple[int, float] | None = None,
               token_limit: tuple[int, float] | None = None) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")  # uvicorn hides app logs
    logging.getLogger("httpx").setLevel(logging.WARNING)  # otherwise one line per Claude/Cartesia request
    if model is None:
        from .llm import ClaudeDialogue
        model = ClaudeDialogue()
    kb = KnowledgeBase.load(knowledge_dir or REPO / "data" / "knowledge" / "pages")
    origins = allowed_origins or os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    chat_rl = RateLimiter(*(chat_limit or env_limit("CHAT_LIMIT", "20/600")))
    token_rl = RateLimiter(*(token_limit or env_limit("TOKEN_LIMIT", "6/600")))
    signals: dict[str, tuple[float, dict]] = {}  # shortcut: in-memory, one process; SpacetimeDB replaces this

    app = FastAPI(title="EQ.ai dialogue")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"])
    log.info("knowledge base: %d passages", len(kb.passages))

    def check_rate(rl: RateLimiter, request: Request) -> None:
        # Behind the tunnel every request comes from 127.0.0.1; Cloudflare puts the visitor's IP in this header.
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")
        if not rl.allow(ip):
            raise HTTPException(status_code=429, detail="Too many requests. Please wait a few minutes.",
                                headers={"Retry-After": str(int(rl.window))})

    @app.get("/health")
    def health():
        return {"ok": True, "passages": len(kb.passages)}

    @app.post("/voice/token")
    def voice_token(request: Request):
        """Browser talks to Cartesia directly (lowest latency); the API key never leaves this server."""
        check_rate(token_rl, request)
        try:
            token = token_minter({"tts": True, "stt": True}, TOKEN_TTL_SEC)
        except CartesiaNotConfigured as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception:  # noqa: BLE001 - network or Cartesia error
            log.exception("Cartesia token request failed")
            raise HTTPException(status_code=502, detail="could not get a Cartesia token")
        return {"token": token, "expires_in": TOKEN_TTL_SEC, "cartesia_version": CARTESIA_VERSION,
                # sonic-3.5: calm 0.8x came out 15% slower than neutral 1x (sonic-3.6: 9%), measured 2026-10-24
                "tts": {"url": "wss://api.cartesia.ai/tts/websocket",
                        "model_id": os.environ.get("CARTESIA_TTS_MODEL") or "sonic-3.5",
                        "voice_id": os.environ.get("CARTESIA_VOICE_ID") or DEFAULT_VOICE,
                        "output_format": {"container": "raw", "encoding": "pcm_f32le", "sample_rate": 24000}},
                # Ink 2 turn detection decides when the student finished speaking; language pinned for accents
                "stt": {"url": "wss://api.cartesia.ai/stt/turns/websocket",
                        "model": os.environ.get("CARTESIA_STT_MODEL") or "ink-2",
                        "encoding": "pcm_s16le", "sample_rate": 16000, "language": "en", "keyterms": STT_KEYTERMS}}

    @app.post("/signals", status_code=204)
    def post_signals(body: Signals):
        signals[body.session_id] = (time.time(), body.model_dump(exclude={"session_id"}))
        return Response(status_code=204)

    @app.post("/handoff")
    def handoff(req: HandoffRequest, request: Request):
        """The advisor's note: Claude summarizes the conversation, or the student's own words if that fails."""
        check_rate(chat_rl, request)
        said = [t.text for t in req.history if t.role == "student"]
        summary = None
        if said:
            try:
                summary = model.summarize(req.topic, req.history)
            except Exception:  # noqa: BLE001 - the handoff must go through even without Claude
                log.exception("handoff summary failed")
        if summary is None:
            return {"source": "fallback",
                    "summary": {"problem": " / ".join(said[-4:]) or "The student hasn't described the problem yet.",
                                "deadline": None, "tried": [],
                                "next_step": "Read the student's messages and follow up with them."}}
        return {"source": "claude", "summary": summary.model_dump()}

    @app.post("/chat")
    def chat(req: ChatRequest, request: Request):
        check_rate(chat_rl, request)
        passages = kb.search(f"{req.topic.replace('_', ' ')} {req.text}", k=4)
        stamped = signals.get(req.session_id)
        latest = stamped[1] if stamped and time.time() - stamped[0] < SIGNAL_TTL_SEC else None
        started = time.perf_counter()
        try:
            turn = model.respond(req, passages, latest)
        except Exception:  # noqa: BLE001 - never leave the student without an answer
            log.exception("model failed")
            turn = None
        timing = {"model_ms": round((time.perf_counter() - started) * 1000)}
        log.info("chat model_ms=%d state=%s", timing["model_ms"], turn.state if turn else "fallback")

        if turn is None:
            return {"reply": {"text": FALLBACK_REPLY, "citations": [], "uncertainty": "no reliable answer"},
                    "tone": {"state": "neutral", "confidence": 0.0, "ask_confirmation": False,
                             "tts_params": {"speed": 0.9, "emotion": "calm"}, "avatar_expression": "concerned"},
                    "behavior": {"mode": "offer_handoff", "offer_handoff": True}, "timing": timing}

        b = decide_behavior(turn.state, turn.evidence, req.awaiting_confirmation)
        text = turn.reply
        if b.show_crisis_resources:
            counseling = os.environ.get("CAMPUS_COUNSELING", "").strip()
            text = " ".join(filter(None, [text, CRISIS, counseling]))
        by_id = {p.id: p for p in passages}
        citations = []
        for pid in turn.cited_ids:
            p = by_id.get(pid)
            if p and all(c["url"] != p.url for c in citations):
                citations.append({"title": p.title, "url": p.url})
        return {"reply": {"text": text, "citations": citations, "uncertainty": turn.uncertainty},
                "tone": {"state": b.state, "confidence": round(turn.confidence, 3),
                         "ask_confirmation": b.ask_confirmation,
                         "tts_params": {"speed": b.tts_speed, "emotion": b.tts_emotion},
                         "avatar_expression": b.avatar_expression},
                "behavior": {"mode": b.mode, "offer_handoff": b.offer_handoff}, "timing": timing}

    return app
