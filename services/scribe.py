"""Speech input via ElevenLabs Scribe (blueprint §04-A, §03 step 02).

Speaker labels come only from the caller (no diarization). Transcript text is stored RAW.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any, Callable, Literal, Optional, Protocol

from starlette.requests import HTTPConnection

from config import Settings
from errors import AppError

logger = logging.getLogger("ps16.scribe")


def scribe_language_code(language: str) -> Optional[str]:
    """en->eng, hi->hin; mixed (code-mixed) -> None so Scribe auto-detects (VERIFIED_API_NOTES)."""
    return {"en": "eng", "hi": "hin"}.get(language)


@dataclass(frozen=True)
class BatchResult:
    text: str
    language_code: Optional[str] = None
    language_probability: Optional[float] = None
    duration_s: Optional[float] = None


@dataclass(frozen=True)
class RealtimeEvent:
    kind: Literal["partial", "committed", "error"]
    text: str = ""
    code: Optional[str] = None


EventHandler = Callable[[RealtimeEvent], None]


class RealtimeSession(Protocol):
    async def send_audio(self, pcm16: bytes) -> None: ...
    async def commit(self) -> None: ...
    async def close(self) -> None: ...


class Transcriber(Protocol):
    async def transcribe(
        self, audio: bytes, filename: str, content_type: Optional[str], language_code: Optional[str]
    ) -> BatchResult: ...

    async def open_realtime(self, language_code: Optional[str], handler: EventHandler) -> RealtimeSession: ...


def _upstream(exc: Exception) -> AppError:
    status = getattr(exc, "status_code", None)
    if status == 401:
        logger.error("ElevenLabs rejected the credentials - check ELEVENLABS_API_KEY")
    else:
        logger.error("ElevenLabs Scribe call failed: %s (status=%s)", type(exc).__name__, status)
    return AppError(502, "upstream_error", "Speech-to-text provider request failed")


class _ElevenLabsRealtime:
    def __init__(self, connection: Any) -> None:
        self._conn = connection

    async def send_audio(self, pcm16: bytes) -> None:
        try:
            await self._conn.send({"audio_base_64": base64.b64encode(pcm16).decode("ascii")})
        except Exception as exc:
            raise _upstream(exc) from exc

    async def commit(self) -> None:
        try:
            await self._conn.commit()
        except Exception as exc:
            raise _upstream(exc) from exc

    async def close(self) -> None:
        try:
            await self._conn.close()
        except Exception:
            logger.exception("error closing Scribe realtime connection")


class ElevenLabsTranscriber:
    """Adapter over the installed `elevenlabs` SDK (2.x). `client` is injectable for tests."""

    def __init__(self, settings: Settings, client: Any = None) -> None:
        self._s = settings
        self._client = client

    def _get_client(self) -> Any:
        if not self._s.elevenlabs_api_key:
            raise AppError(503, "not_configured", "ELEVENLABS_API_KEY is not configured")
        if self._client is None:
            from elevenlabs import AsyncElevenLabs

            self._client = AsyncElevenLabs(api_key=self._s.elevenlabs_api_key)
        return self._client

    async def transcribe(
        self, audio: bytes, filename: str, content_type: Optional[str], language_code: Optional[str]
    ) -> BatchResult:
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "model_id": self._s.scribe_batch_model,
            "file": (filename, audio, content_type),
        }
        if language_code is not None:  # omit entirely for code-mixed input
            kwargs["language_code"] = language_code
        try:
            resp = await client.speech_to_text.convert(**kwargs)
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc
        text = getattr(resp, "text", None)
        if not isinstance(text, str):
            logger.error("unexpected Scribe response type: %s", type(resp).__name__)
            raise AppError(502, "upstream_error", "Speech-to-text provider returned an unexpected response")
        prob = getattr(resp, "language_probability", None)
        dur = getattr(resp, "audio_duration_secs", None)
        return BatchResult(
            text=text,
            language_code=getattr(resp, "language_code", None),
            language_probability=float(prob) if prob is not None else None,
            duration_s=float(dur) if dur is not None else None,
        )

    async def open_realtime(self, language_code: Optional[str], handler: EventHandler) -> RealtimeSession:
        client = self._get_client()
        from elevenlabs import AudioFormat, CommitStrategy, RealtimeAudioOptions, RealtimeEvents

        options: dict[str, Any] = {
            "model_id": self._s.scribe_realtime_model,
            "audio_format": AudioFormat.PCM_16000,
            "sample_rate": 16000,
            "commit_strategy": CommitStrategy.MANUAL,  # user-triggered "finish speaking"
        }
        if language_code is not None:
            options["language_code"] = language_code
        try:
            conn = await client.speech_to_text.realtime.connect(RealtimeAudioOptions(**options))
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc

        def text_of(data: Any) -> str:
            # The API sends "text"; the SDK docstrings mention "transcript" - accept both.
            if isinstance(data, dict):
                return str(data.get("text") or data.get("transcript") or "")
            return ""

        conn.on(RealtimeEvents.PARTIAL_TRANSCRIPT, lambda d: handler(RealtimeEvent("partial", text_of(d))))
        conn.on(RealtimeEvents.COMMITTED_TRANSCRIPT, lambda d: handler(RealtimeEvent("committed", text_of(d))))

        def on_error(d: Any) -> None:
            code = d.get("message_type") if isinstance(d, dict) else None
            logger.error("Scribe realtime error event: %s", code or "error")
            handler(RealtimeEvent("error", code=code or "error"))

        conn.on(RealtimeEvents.ERROR, on_error)
        return _ElevenLabsRealtime(conn)


def get_transcriber(request: HTTPConnection) -> Transcriber:
    return ElevenLabsTranscriber(request.app.state.settings)
