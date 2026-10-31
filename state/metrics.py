"""Per-message-chain timing and outcome metrics (M9; read by M10).

A chain is one patient turn: finish -> proposal(s) -> confirm -> speak. All *_ms stamps are session-clock
milliseconds; durations are measured, never assumed (I10).
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, computed_field

from schemas import Turn
from state.sessions import Session


class TurnMetrics(BaseModel):
    session_id: str
    turn_id: str
    language: str
    transcript_raw: str
    reference_transcript: Optional[str] = None  # only filled by evaluation runs
    intent: Optional[str] = None
    clarification_required: Optional[bool] = None
    # stage durations
    scribe_ms: Optional[int] = None
    vision_ms: Optional[int] = None
    fusion_ms: Optional[int] = None
    tts_first_audio_ms: Optional[int] = None
    # session-clock stamps
    finish_received_ms: Optional[int] = None
    proposal_ready_ms: Optional[int] = None
    confirmed_ms: Optional[int] = None
    speak_received_ms: Optional[int] = None
    first_audio_ms: Optional[int] = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def system_latency_ms(self) -> Optional[int]:
        """(proposal_ready - finish_received) + (first_audio - speak_received); excludes human decision time."""
        parts = (self.finish_received_ms, self.proposal_ready_ms, self.speak_received_ms, self.first_audio_ms)
        if any(p is None for p in parts):
            return None
        return (self.proposal_ready_ms - self.finish_received_ms) + (self.first_audio_ms - self.speak_received_ms)  # type: ignore[operator]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def wall_clock_ms(self) -> Optional[int]:
        """first_audio - finish_received; includes human decision time."""
        if self.first_audio_ms is None or self.finish_received_ms is None:
            return None
        return self.first_audio_ms - self.finish_received_ms

    @computed_field  # type: ignore[prop-decorator]
    @property
    def human_wait_ms(self) -> Optional[int]:
        """confirmed - proposal_ready."""
        if self.confirmed_ms is None or self.proposal_ready_ms is None:
            return None
        return self.confirmed_ms - self.proposal_ready_ms


class MetricsStore:
    def __init__(self) -> None:
        self._by_session: dict[str, dict[str, TurnMetrics]] = {}

    def touch(self, session: Session, turn: Turn) -> TurnMetrics:
        chain = self._by_session.setdefault(session.session_id, {})
        m = chain.get(turn.turn_id)
        if m is None:
            m = chain[turn.turn_id] = TurnMetrics(
                session_id=session.session_id, turn_id=turn.turn_id, language=turn.language, transcript_raw=turn.text
            )
        return m

    def get(self, session_id: str, turn_id: str) -> Optional[TurnMetrics]:
        return self._by_session.get(session_id, {}).get(turn_id)

    def list(self, session_id: str) -> list[TurnMetrics]:
        return list(self._by_session.get(session_id, {}).values())

    def set(self, session: Session, turn: Turn, **fields: Any) -> TurnMetrics:
        m = self.touch(session, turn)
        for k, v in fields.items():
            setattr(m, k, v)
        return m

    def set_if_unset(self, session: Session, turn: Turn, **fields: Any) -> TurnMetrics:
        m = self.touch(session, turn)
        for k, v in fields.items():
            if getattr(m, k) is None:
                setattr(m, k, v)
        return m

    def close_session(self, session: Session) -> None:
        self._by_session.pop(session.session_id, None)
