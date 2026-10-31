"""Mock-mode test doubles. NOT a model of real behaviour: results built from these are labelled
`"mode": "mock"` and are never measurements (I10).
"""
from __future__ import annotations

import json
from typing import AsyncIterator

from evaluation.metrics import tokenize
from services.fusion import Completion
from services.tts import VoiceInfo

# (intent, trigger words) - whole-token matches only
INTENT_WORDS: list[tuple[str, set[str]]] = [
    ("request_water", {"water", "पानी"}),
    ("request_tea", {"tea", "चाय"}),
    ("request_bathroom", {"bathroom", "toilet", "washroom", "बाथरूम"}),
    ("request_phone_call", {"call", "phone", "फोन"}),
    ("request_blanket", {"blanket", "cold", "कंबल"}),
    ("request_tv_off", {"television", "tv"}),
    ("request_light_off", {"light", "बत्ती", "लाइट"}),
    ("request_rest", {"rest", "tired", "sleep"}),
    ("request_food", {"hungry", "food", "soup", "eat"}),
]
YES = {"yes", "yeah", "haan", "हाँ", "हां"}
NO = {"no", "nahi", "नहीं"}

REPLIES = {
    "request_water": ["I would like water, please.", "Could I have some water?"],
    "request_tea": ["I would like tea, please.", "Could I have some tea?"],
    "request_pause": ["Please wait a moment.", "Give me a moment, please."],
    "confirm_yes": ["Yes, please.", "Yes, that is right."],
    "decline_no": ["No, thank you.", "No, I do not want that."],
}


def _match(tokens: list[str]) -> list[str]:
    return [intent for intent, words in INTENT_WORDS if words & set(tokens)]


def _replies(intent: str) -> list[str]:
    if intent in REPLIES:
        return REPLIES[intent]
    if intent.startswith("decline_"):
        return REPLIES["decline_no"]
    phrase = intent.replace("request_", "").replace("_", " ")
    return [f"I would like {phrase}, please.", f"Could you help me with {phrase}?"]


def _clarify(why: str) -> dict:
    return {"intent": "unclear", "candidate_replies": [], "clarification_required": True, "reasoning_summary": why}


def decide(packet: dict) -> dict:
    """Keyword rules over the evidence packet. Deliberately simple and imperfect."""
    tokens = tokenize(packet["transcript"])
    cue = ((packet["visual_cues"].get("gesture") or {}).get("meaning"))
    partner = [c["text"] for c in packet["conversation_context"] if c["speaker"] == "partner"]
    topics = _match(tokenize(partner[-1])) if partner else []
    direct = _match(tokens)
    said_yes, said_no = bool(YES & set(tokens)), bool(NO & set(tokens))
    if direct:
        if (said_yes and cue == "no") or (said_no and cue == "yes"):
            return _clarify("Speech and gesture conflict.")
        intent = direct[0]
    elif cue == "pause":
        intent = "request_pause"
    elif said_yes or cue == "yes":
        if len(topics) != 1 and said_yes is False:
            return _clarify("Gesture says yes but the question is unclear.")
        intent = topics[0] if len(topics) == 1 else "confirm_yes"
    elif said_no or cue == "no":
        intent = f"decline_{topics[0].replace('request_', '')}" if len(topics) == 1 else "decline_no"
    else:
        return _clarify("Transcript is not clear enough to interpret.")
    return {
        "intent": intent,
        "candidate_replies": _replies(intent),
        "clarification_required": False,
        "reasoning_summary": "Rule-based mock interpretation.",
    }


class MockChatLLM:
    """Drop-in ChatLLM: reads the evidence packet from the user message and applies `decide`."""

    async def complete(self, messages: list[dict[str, str]]) -> Completion:
        packet = json.loads(messages[1]["content"])
        return Completion(json.dumps(decide(packet), ensure_ascii=False))


class MockSynth:
    """Drop-in SpeechSynthesizer producing a few placeholder bytes."""

    async def stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]:
        yield b"mock-audio"

    async def list_voices(self) -> list[VoiceInfo]:
        return []

    async def clone_voice(self, *a, **k) -> str:  # pragma: no cover - never used in eval
        raise NotImplementedError

    async def design_voice(self, *a, **k) -> str:  # pragma: no cover - never used in eval
        raise NotImplementedError
