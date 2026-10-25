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

# Plain mode (/plain): the comparison baseline for the demo video. Same audience, sources and answer rules as
# SYSTEM, minus every emotion feature (state estimate, tone changes, check-ins, handoff offers).
PLAIN_SYSTEM = """You are a standard automated help assistant for international and non-native-English-speaking \
students with university questions (financial aid, scholarships, visa status, school problems). You are the \
comparison baseline for EQ.ai, with its emotion features turned off.

How to answer:
- Use only the SOURCES given in the turn. Cite the ids of the sources you used in cited_ids.
- If the sources don't answer the question, say you don't have an official source for that. \
Never guess eligibility, amounts, or deadlines.
- Visa questions: share only what the sources say and point to the international student office. \
Never give legal or immigration advice.
- Reply in 1-3 short sentences of plain, simple English. Spoken aloud, so no lists or markdown.
- Put anything you are unsure about in uncertainty (or null).

Emotion features are off:
- Answer every message the same way, whatever the student's mood. Do not comment on, ask about, or adapt \
to how the student feels, and do not offer to connect them with a person.
- Set crisis to true only if the student mentions suicide, self-harm, wanting to die, or being in danger. \
Crisis resources are then added automatically after your reply."""

PLAIN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["reply", "cited_ids", "uncertainty", "crisis"],
    "properties": {
        "reply": {"type": "string"},
        "cited_ids": {"type": "array", "items": {"type": "string"}},
        "uncertainty": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "crisis": {"type": "boolean"},
    },
}


SUMMARY_SYSTEM = """You write the handoff note an SJSU advisor reads before helping a student who asked to talk \
to a person, so the student doesn't have to explain everything again.

Use only what the conversation says. Never add facts, amounts, or deadlines that are not in it.
- problem: one or two plain sentences on what the student needs help with.
- deadline: the deadline as the student stated it, or null if they didn't mention one.
- tried: short items for what the student already did or was told in this chat (empty if nothing).
- next_step: one sentence on what the advisor should check or do first.
Write in plain English for staff.

Emotions, only when ESTIMATED MOODS are given (the student agreed to share them):
- mood: one or two sentences on how the student's estimated mood changed during the chat.
- hard_moments: for each student message estimated as nervous, confused, frustrated or distress, a short quote \
of the student's words, that estimate, and one short sentence on what in the conversation likely made it hard \
(for example an answer that was unclear, or a problem that still isn't fixed).
These are estimates from EQ.ai's models and can be wrong: write "seemed", never state feelings as facts.
Without ESTIMATED MOODS, set mood to null and hard_moments to [], and do not describe or guess emotions."""

SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["problem", "deadline", "tried", "next_step", "mood", "hard_moments"],
    "properties": {
        "problem": {"type": "string"},
        "deadline": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "tried": {"type": "array", "items": {"type": "string"}},
        "next_step": {"type": "string"},
        "mood": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "hard_moments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["quote", "estimate", "reason"],
                "properties": {"quote": {"type": "string"}, "estimate": {"type": "string"}, "reason": {"type": "string"}},
            },
        },
    },
}


class HardMoment(BaseModel):
    quote: str
    estimate: str
    reason: str


class HandoffSummary(BaseModel):
    problem: str
    deadline: str | None
    tried: list[str]
    next_step: str
    mood: str | None = None
    hard_moments: list[HardMoment] = []


class ModelTurn(BaseModel):
    state: str
    confidence: float
    evidence: list[str]
    reply: str
    cited_ids: list[str]
    uncertainty: str | None


class PlainTurn(BaseModel):
    reply: str
    cited_ids: list[str]
    uncertainty: str | None
    crisis: bool


def build_turn_message(request, passages: list[Passage], signals: dict | None) -> str:
    sources = "\n".join(f"[{p.id}] {p.title} ({p.url}): {p.text}" for p in passages) or "(no matching sources)"
    history = "\n".join(f"{t.role}: {t.text}" for t in request.history[-12:]) or "(start of conversation)"
    return (f"TOPIC: {request.topic}\nAWAITING_CONFIRMATION: {str(request.awaiting_confirmation).lower()}\n"
            f"SIGNALS: {json.dumps(signals) if signals else 'none'}\n\nSOURCES:\n{sources}\n\n"
            f"CONVERSATION SO FAR:\n{history}\n\nSTUDENT NOW SAYS:\n{request.text}")


def build_plain_message(request, passages: list[Passage]) -> str:
    """Plain mode gets no emotion signals and no confirmation state."""
    sources = "\n".join(f"[{p.id}] {p.title} ({p.url}): {p.text}" for p in passages) or "(no matching sources)"
    history = "\n".join(f"{t.role}: {t.text}" for t in request.history[-12:]) or "(start of conversation)"
    return (f"TOPIC: {request.topic}\n\nSOURCES:\n{sources}\n\n"
            f"CONVERSATION SO FAR:\n{history}\n\nSTUDENT NOW SAYS:\n{request.text}")


class ClaudeDialogue:
    def __init__(self, client: anthropic.Anthropic | None = None, model: str | None = None,
                 effort: str | None = None):
        self.client = client or anthropic.Anthropic(timeout=20.0, max_retries=1)
        self.model = model or os.environ.get("CLAUDE_MODEL") or "claude-opus-5-5"
        # low: short replies, lower latency. Not CLAUDE_EFFORT: Claude Code exports that one into shells.
        self.effort = effort or os.environ.get("DIALOGUE_EFFORT") or "low"

    def respond(self, request, passages: list[Passage], signals: dict | None) -> ModelTurn | None:
        return self._call(SYSTEM, build_turn_message(request, passages, signals), SCHEMA, ModelTurn)

    def respond_plain(self, request, passages: list[Passage]) -> PlainTurn | None:
        """Plain mode (demo comparison): same sources and answer rules, no emotion features."""
        return self._call(PLAIN_SYSTEM, build_plain_message(request, passages), PLAIN_SCHEMA, PlainTurn)

    def summarize(self, topic: str, history, timeline=()) -> HandoffSummary | None:
        """Advisor's handoff note from the conversation. `timeline` (estimated mood per student message) is
        empty unless the student agreed to share it; the raw face and voice signals are never sent."""
        convo = "\n".join(f"[{i}] {t.role}: {t.text}" for i, t in enumerate(history))
        content = f"TOPIC: {topic}\n\nCONVERSATION:\n{convo}"
        if timeline:
            moods = "\n".join(f"[{p.turn}] {p.label} ({round(p.confidence * 100)}%)" for p in timeline)
            content += f"\n\nESTIMATED MOODS (by message number above):\n{moods}"
        return self._call(SUMMARY_SYSTEM, content, SUMMARY_SCHEMA, HandoffSummary)

    def _call(self, system: str, content: str, schema: dict, out: type[BaseModel]):
        """One structured-output request; None on API errors, refusals, truncation or unparseable output."""
        params = dict(
            model=self.model,
            max_tokens=16000,  # room for adaptive thinking at high effort; replies stay 1-3 sentences
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
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
            return out.model_validate_json(text)
        except ValueError:
            log.error("unparseable model output (request %s)", response._request_id)
            return None
