"""Dialogue HTTP service: POST /chat for the student web app, POST /signals for the Jetson.

Run from the repo root:
  .venv/Scripts/uvicorn services.dialogue.app:create_app --factory --port 8000
Env: ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_EFFORT, ALLOWED_ORIGINS, CAMPUS_COUNSELING,
     CARTESIA_API_KEY, CARTESIA_VOICE_ID, CARTESIA_STT_MODEL.
"""

import logging
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Response
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


class Turn(BaseModel):
    role: Literal["student", "assistant"]
    text: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    topic: Literal["financial_aid_hold", "scholarships", "visa_status", "other"]
    text: str = Field(max_length=4000)
    history: list[Turn] = Field(default_factory=list, max_length=40)
    awaiting_confirmation: bool = False

    @field_validator("text")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text is empty")
        return v.strip()


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
               token_minter=cartesia_minter) -> FastAPI:
    if model is None:
        from .llm import ClaudeDialogue
        model = ClaudeDialogue()
    kb = KnowledgeBase.load(knowledge_dir or REPO / "data" / "knowledge" / "pages")
    origins = allowed_origins or os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    signals: dict[str, tuple[float, dict]] = {}  # shortcut: in-memory, one process; SpacetimeDB replaces this

    app = FastAPI(title="EQ.ai dialogue")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"])
    log.info("knowledge base: %d passages", len(kb.passages))

    @app.get("/health")
    def health():
        return {"ok": True, "passages": len(kb.passages)}

    @app.post("/voice/token")
    def voice_token():
        """Browser talks to Cartesia directly (lowest latency); the API key never leaves this server."""
        try:
            token = token_minter({"tts": True, "stt": True}, TOKEN_TTL_SEC)
        except CartesiaNotConfigured as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception:  # noqa: BLE001 - network or Cartesia error
            log.exception("Cartesia token request failed")
            raise HTTPException(status_code=502, detail="could not get a Cartesia token")
        return {"token": token, "expires_in": TOKEN_TTL_SEC, "cartesia_version": CARTESIA_VERSION,
                "tts": {"url": "wss://api.cartesia.ai/tts/websocket", "model_id": "sonic-3.6",
                        "voice_id": os.environ.get("CARTESIA_VOICE_ID") or DEFAULT_VOICE,
                        "output_format": {"container": "raw", "encoding": "pcm_f32le", "sample_rate": 24000}},
                "stt": {"url": "wss://api.cartesia.ai/stt/websocket",
                        "model": os.environ.get("CARTESIA_STT_MODEL") or "ink-whisper",
                        "encoding": "pcm_s16le", "sample_rate": 16000, "language": "en"}}

    @app.post("/signals", status_code=204)
    def post_signals(body: Signals):
        signals[body.session_id] = (time.time(), body.model_dump(exclude={"session_id"}))
        return Response(status_code=204)

    @app.post("/chat")
    def chat(req: ChatRequest):
        passages = kb.search(f"{req.topic.replace('_', ' ')} {req.text}", k=4)
        stamped = signals.get(req.session_id)
        latest = stamped[1] if stamped and time.time() - stamped[0] < SIGNAL_TTL_SEC else None
        try:
            turn = model.respond(req, passages, latest)
        except Exception:  # noqa: BLE001 - never leave the student without an answer
            log.exception("model failed")
            turn = None

        if turn is None:
            return {"reply": {"text": FALLBACK_REPLY, "citations": [], "uncertainty": "no reliable answer"},
                    "tone": {"state": "neutral", "confidence": 0.0, "ask_confirmation": False,
                             "tts_params": {"speed": 0.9, "emotion": "calm"}, "avatar_expression": "concerned"},
                    "behavior": {"mode": "offer_handoff", "offer_handoff": True}}

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
                "behavior": {"mode": b.mode, "offer_handoff": b.offer_handoff}}

    return app
