"""Per-session rolling dialogue history (blueprint §03 step 04, §05 "Load the last 4-6 dialogue turns")."""
from __future__ import annotations

import uuid

from clock import Clock
from schemas import Language, Speaker, Turn, TurnSource


class ConversationState:
    def __init__(self, clock: Clock, window: int = 6) -> None:
        if not 4 <= window <= 6:
            raise ValueError("history window must be between 4 and 6 turns")
        self._clock = clock
        self.window = window
        self._turns: list[Turn] = []

    def add_turn(self, speaker: Speaker, text: str, language: Language, source: TurnSource) -> Turn:
        """Append a turn stamped with the session clock (never lower than the previous turn)."""
        ts = self._clock.now_ms()
        if self._turns:
            ts = max(ts, self._turns[-1].timestamp_ms)
        turn = Turn(
            turn_id=uuid.uuid4().hex,
            speaker=speaker,
            text=text,
            language=language,
            timestamp_ms=ts,
            source=source,
        )
        self._turns.append(turn)
        return turn

    def recent(self, n: int | None = None) -> list[Turn]:
        n = self.window if n is None else n
        if n <= 0:
            return []
        return list(self._turns[-n:])

    def render_context(self, n: int | None = None, exclude_turn_id: str | None = None) -> list[dict[str, str]]:
        """Blueprint evidence-packet shape: [{"speaker","text"}], oldest first.

        The excluded turn (the current patient turn) is removed BEFORE trimming,
        so the window still holds up to n earlier turns.
        """
        n = self.window if n is None else n
        turns = [t for t in self._turns if t.turn_id != exclude_turn_id]
        if n <= 0:
            return []
        return [{"speaker": t.speaker, "text": t.text} for t in turns[-n:]]

    def clear(self) -> None:
        self._turns.clear()
