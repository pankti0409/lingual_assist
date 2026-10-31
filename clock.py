"""Session clock contract (CLAUDE.md): injectable monotonic milliseconds."""
from __future__ import annotations

import time
from typing import Protocol


class Clock(Protocol):
    def now_ms(self) -> int:
        """Monotonic milliseconds since this clock was created."""
        ...


class SystemClock:
    def __init__(self) -> None:
        self._t0 = time.monotonic()

    def now_ms(self) -> int:
        return int((time.monotonic() - self._t0) * 1000)


class FakeClock:
    """Advances only when told; tests never sleep."""

    def __init__(self, start_ms: int = 0) -> None:
        self._now = start_ms

    def now_ms(self) -> int:
        return self._now

    def advance(self, ms: int) -> None:
        if ms < 0:
            raise ValueError("clock cannot go backwards")
        self._now += ms


class Timer:
    """Measures elapsed milliseconds against a Clock."""

    def __init__(self, clock: Clock) -> None:
        self._clock = clock
        self._start = clock.now_ms()

    def elapsed_ms(self) -> int:
        return self._clock.now_ms() - self._start

    def reset(self) -> None:
        self._start = self._clock.now_ms()
