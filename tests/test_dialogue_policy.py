"""Behavior policy (CLAUDE.md section 4). Run: python -m unittest discover -s tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.dialogue.policy import decide_behavior  # noqa: E402


class BehaviorPolicy(unittest.TestCase):
    def test_neutral_answers_normally(self):
        b = decide_behavior("neutral", evidence=["text"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "normal")
        self.assertFalse(b.offer_handoff)
        self.assertFalse(b.ask_confirmation)
        self.assertEqual((b.tts_emotion, b.tts_speed), ("neutral", 1.0))

    def test_confused_slows_down_and_rephrases(self):
        b = decide_behavior("confused", evidence=["text"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "slow_rephrase")
        self.assertEqual((b.tts_emotion, b.tts_speed), ("calm", 0.8))

    def test_nervous_gets_a_calm_slower_voice(self):
        b = decide_behavior("nervous", evidence=["face", "voice"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "slow_rephrase")
        self.assertEqual((b.tts_emotion, b.tts_speed), ("calm", 0.85))
        self.assertEqual(b.avatar_expression, "concerned")

    def test_frustrated_asks_first_before_acting(self):
        b = decide_behavior("frustrated", evidence=["text", "voice"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "confirm")
        self.assertTrue(b.ask_confirmation)
        self.assertTrue(b.offer_handoff)

    def test_frustrated_after_student_confirmed_offers_handoff_without_asking_again(self):
        b = decide_behavior("frustrated", evidence=["text"], awaiting_confirmation=True)
        self.assertEqual(b.mode, "offer_handoff")
        self.assertFalse(b.ask_confirmation)
        self.assertTrue(b.offer_handoff)

    def test_voice_alone_never_triggers_an_action(self):
        b = decide_behavior("frustrated", evidence=["voice"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "confirm")
        self.assertTrue(b.ask_confirmation)
        self.assertFalse(b.offer_handoff)

    def test_distress_stops_the_task_and_offers_a_human(self):
        b = decide_behavior("distress", evidence=["text"], awaiting_confirmation=False)
        self.assertEqual(b.mode, "distress")
        self.assertTrue(b.offer_handoff)
        self.assertTrue(b.show_crisis_resources)

    def test_unknown_state_is_treated_as_neutral(self):
        b = decide_behavior("ecstatic", evidence=["text"], awaiting_confirmation=False)
        self.assertEqual((b.state, b.mode), ("neutral", "normal"))


if __name__ == "__main__":
    unittest.main()
