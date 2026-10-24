"""Behavior policy: estimated student state -> what the assistant does (CLAUDE.md section 4).

Claude estimates the state; these rules decide the action, so safety rules hold even if
the model gets something wrong:
- voice signal alone never triggers an action, it only makes the assistant ask
- frustration is confirmed with the student before a handoff is pushed
- distress always stops the task and shows crisis resources
"""

from dataclasses import dataclass

# state -> (mode, Cartesia emotion, speed, avatar expression). Tune emotion/speed by ear.
STYLE = {
    "neutral": ("normal", "neutral", 1.0, "neutral"),
    "nervous": ("slow_rephrase", "calm", 0.85, "concerned"),
    "confused": ("slow_rephrase", "calm", 0.8, "thinking"),
    "frustrated": ("offer_handoff", "calm", 0.9, "concerned"),
    "distress": ("distress", "calm", 0.8, "concerned"),
}
STATES = tuple(STYLE)


@dataclass(frozen=True)
class Behavior:
    state: str
    mode: str
    ask_confirmation: bool
    offer_handoff: bool
    show_crisis_resources: bool
    tts_emotion: str
    tts_speed: float
    avatar_expression: str


def decide_behavior(state: str, evidence: list[str], awaiting_confirmation: bool) -> Behavior:
    """evidence: which signals support the state ("text", "face", "voice").
    awaiting_confirmation: the previous reply asked the student whether the estimate was right."""
    if state not in STYLE:
        state = "neutral"
    mode, emotion, speed, avatar = STYLE[state]
    ask = offer = False

    if state == "frustrated":
        offer = True
        if not awaiting_confirmation:
            mode, ask = "confirm", True
    if state == "distress":
        offer = True
    if state != "neutral" and set(evidence) == {"voice"} and state != "distress":
        mode, ask, offer = "confirm", True, False  # voice alone: ask, never act

    return Behavior(state, mode, ask, offer, state == "distress", emotion, speed, avatar)
