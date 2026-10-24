"""One Claude call per student turn: estimated state + short, source-grounded reply (option B).

Claude returns JSON (structured outputs). The behavior policy, tone settings, citations and
crisis resources are applied afterwards in code, so they don't depend on the model.
"""

import json
import logging
import os

import anthropic
from pydantic import BaseModel

from .policy import STATES
from .retrieval import Passage

log = logging.getLogger("dialogue")

# Models that accept the server-side refusal fallback (see the claude-api skill).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

SYSTEM = """You are EQ.ai, a voice assistant that helps international and non-native-English-speaking \
students with stressful university questions (financial aid, scholarships, visa status, school problems).

How to answer:
- Use only the SOURCES given in the turn. Cite the ids of the sources you used in cited_ids.
- If the sources don't answer the question, say you don't have an official source for that and offer \
to connect the student with an advisor. Never guess eligibility, amounts, or deadlines.
- Visa questions: share only what the sources say and point to the international student office. \
Never give legal or immigration advice.
- Reply in 1-3 short sentences of plain, simple English. Spoken aloud, so no lists or markdown.
- Put anything you are unsure about in uncertainty (or null).

Estimating the student's state:
- Choose state from: neutral, nervous, confused, frustrated, distress.
- Base it on the student's words and the SIGNALS (face and voice classifier outputs, may be missing).
  Classifiers can be wrong, especially with accents. List in evidence which inputs support your estimate.
- Speak about the estimate as an estimate. Never say you feel or understand emotions.
- If you estimate frustration and the student hasn't confirmed it yet, gently ask whether you are \
reading the situation right, e.g. "It sounds like this is frustrating. Am I reading that right?"
- If AWAITING_CONFIRMATION is true, the student is answering that question: if they say no, \
return state neutral and continue helping.
- nervous or confused: be calm and reassuring, use simpler words, give one concrete next step.
- distress (hopelessness, crisis, self-harm): stop the task, respond with care and offer a person \
to talk to. Crisis resources are added automatically after your reply."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["state", "confidence", "evidence", "reply", "cited_ids", "uncertainty"],
    "properties": {
        "state": {"type": "string", "enum": list(STATES)},
        "confidence": {"type": "number"},
        "evidence": {"type": "array", "items": {"type": "string", "enum": ["text", "face", "voice"]}},
        "reply": {"type": "string"},
        "cited_ids": {"type": "array", "items": {"type": "string"}},
        "uncertainty": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    },
}


class ModelTurn(BaseModel):
    state: str
    confidence: float
    evidence: list[str]
    reply: str
    cited_ids: list[str]
    uncertainty: str | None


def build_turn_message(request, passages: list[Passage], signals: dict | None) -> str:
    sources = "\n".join(f"[{p.id}] {p.title} ({p.url}): {p.text}" for p in passages) or "(no matching sources)"
    history = "\n".join(f"{t.role}: {t.text}" for t in request.history[-12:]) or "(start of conversation)"
    return (f"TOPIC: {request.topic}\nAWAITING_CONFIRMATION: {str(request.awaiting_confirmation).lower()}\n"
            f"SIGNALS: {json.dumps(signals) if signals else 'none'}\n\nSOURCES:\n{sources}\n\n"
            f"CONVERSATION SO FAR:\n{history}\n\nSTUDENT NOW SAYS:\n{request.text}")


class ClaudeDialogue:
    def __init__(self, client: anthropic.Anthropic | None = None, model: str | None = None,
                 effort: str | None = None):
        self.client = client or anthropic.Anthropic(timeout=20.0, max_retries=1)
        self.model = model or os.environ.get("CLAUDE_MODEL") or "claude-opus-5-5"
        self.effort = effort or os.environ.get("CLAUDE_EFFORT") or "low"  # low: short replies, lower latency

    def respond(self, request, passages: list[Passage], signals: dict | None) -> ModelTurn | None:
        params = dict(
            model=self.model,
            max_tokens=4000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": build_turn_message(request, passages, signals)}],
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        try:
            if self.model in FALLBACK_MODELS:
                response = self.client.beta.messages.create(
                    **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            else:
                response = self.client.messages.create(**params)
        except anthropic.APIConnectionError as e:
            log.error("Claude unreachable: %s", e)
            return None
        except anthropic.APIStatusError as e:
            log.error("Claude API error %s: %s", e.status_code, e.message)
            return None

        if response.stop_reason in ("refusal", "max_tokens"):
            log.warning("Claude stopped with %s (request %s)", response.stop_reason, response._request_id)
            return None
        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            return ModelTurn.model_validate_json(text)
        except ValueError:
            log.error("unparseable model output (request %s)", response._request_id)
            return None
