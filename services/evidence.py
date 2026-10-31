"""Evidence packet builder (blueprint §05 "Suggested evidence packet", §03 step 04).

The LLM only ever sees this compact, timestamped packet - never raw audio/video (I3).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from schemas import Language, Speaker, Turn
from services.vision import VisionSession
from state.sessions import Session


class ContextTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker: Speaker
    text: str


class GestureEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    score: float
    meaning: Optional[str] = None  # from the per-session gesture map (I7); additive field


class VisualCues(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gesture: Optional[GestureEvidence] = None
    mouth_activity: bool = False
    head_nod: bool = False


class EvidencePacket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker: Literal["patient"] = "patient"
    transcript: str
    language: Language
    timestamp_ms: int
    conversation_context: list[ContextTurn]
    visual_cues: VisualCues


def visual_cues_at(session: Session, vision: Optional[VisionSession], ts_ms: int) -> VisualCues:
    """Stable, fresh, above-threshold gesture and windowed mouth/nod values as of `ts_ms`.

    Cues are used only while face_capture consent is still given (I8).
    """
    if vision is None or not session.consent.face_capture:
        return VisualCues()
    cue = vision.tracker.cue_at(ts_ms, vision.gesture_map)
    if cue is None:
        return VisualCues()
    gesture = None
    if cue.gesture is not None and cue.gesture.stable:
        gesture = GestureEvidence(label=cue.gesture.label, score=cue.gesture.score, meaning=cue.gesture.meaning)
    return VisualCues(gesture=gesture, mouth_activity=cue.face.mouth_activity, head_nod=cue.face.head_nod)


def build_packet(
    session: Session, turn: Turn, vision: Optional[VisionSession], include_visual_cues: bool = True
) -> EvidencePacket:
    """Pure function of session state: the same state always yields the same packet."""
    context = session.conversation.context_before(turn.turn_id)  # excludes the current turn
    cues = visual_cues_at(session, vision, turn.timestamp_ms) if include_visual_cues else VisualCues()
    return EvidencePacket(
        transcript=turn.text,
        language=turn.language,
        timestamp_ms=turn.timestamp_ms,
        conversation_context=[ContextTurn(**c) for c in context],
        visual_cues=cues,
    )
