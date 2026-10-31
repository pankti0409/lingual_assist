"""In-memory session store (blueprint §01 "Consent"; CLAUDE.md clock contract)."""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal, Optional

from clock import Clock
from state.conversation import ConversationState

logger = logging.getLogger("ps16.sessions")

Language = Literal["en", "hi", "mixed"]
VoiceMode = Literal["clone", "designed", "none"]
CONSENT_PURPOSES = ("audio_recording", "face_capture", "voice_cloning", "demo_use")


class SessionClock:
    """Server-side monotonic milliseconds since session creation."""

    def __init__(self, base: Clock) -> None:
        self._base = base
        self._t0 = base.now_ms()

    def now_ms(self) -> int:
        return self._base.now_ms() - self._t0


@dataclass
class ConsentRecord:
    audio_recording: bool = False
    face_capture: bool = False
    voice_cloning: bool = False
    demo_use: bool = False
    recorded_ms: Optional[int] = None
    recorded_at: Optional[str] = None  # ISO-8601 UTC wall time

    def allows(self, purpose: str) -> bool:
        return bool(getattr(self, purpose, False))


@dataclass
class Session:
    session_id: str
    language: Language
    voice_mode: VoiceMode
    clock: SessionClock
    created_at: str
    conversation: ConversationState
    consent: ConsentRecord = field(default_factory=ConsentRecord)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


CleanupHook = Callable[[Session], None]


class SessionStore:
    def __init__(self, clock: Clock, history_window: int = 6) -> None:
        self._clock = clock
        self._history_window = history_window
        self._sessions: dict[str, Session] = {}
        self._cleanup_hooks: list[CleanupHook] = []

    def register_cleanup(self, hook: CleanupHook) -> None:
        """Later modules register hooks that purge their per-session data on delete."""
        self._cleanup_hooks.append(hook)

    def create(self, language: Language = "en", voice_mode: VoiceMode = "none") -> Session:
        clock = SessionClock(self._clock)
        session = Session(
            session_id=uuid.uuid4().hex,
            language=language,
            voice_mode=voice_mode,
            clock=clock,
            conversation=ConversationState(clock, self._history_window),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        session.conversation.clear()
        for hook in self._cleanup_hooks:
            try:
                hook(session)
            except Exception:  # a failing hook must not keep data alive
                logger.exception("session cleanup hook failed")
        return True

    def set_consent(self, session: Session, flags: dict[str, bool]) -> ConsentRecord:
        """Replace all flags and stamp with server time."""
        session.consent = ConsentRecord(
            **{p: bool(flags.get(p, False)) for p in CONSENT_PURPOSES},
            recorded_ms=session.clock.now_ms(),
            recorded_at=datetime.now(timezone.utc).isoformat(),
        )
        return session.consent
