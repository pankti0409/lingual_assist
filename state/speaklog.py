"""Per-session log of spoken messages (M8; feeds M10 latency/effort metrics)."""
from __future__ import annotations

from dataclasses import dataclass

from state.sessions import Session


@dataclass(frozen=True)
class SpeakRecord:
    confirmed_id: str
    spoken_at_ms: int
    tts_first_audio_ms: int
    persona: str


class SpeakLog:
    def __init__(self) -> None:
        self._by_session: dict[str, list[SpeakRecord]] = {}

    def add(self, session_id: str, record: SpeakRecord) -> None:
        self._by_session.setdefault(session_id, []).append(record)

    def list(self, session_id: str) -> list[SpeakRecord]:
        return list(self._by_session.get(session_id, []))

    def close_session(self, session: Session) -> None:
        self._by_session.pop(session.session_id, None)
