"""Voice output via ElevenLabs (blueprint §04-E, §01 personalised output).

Only text from a confirmed message is ever synthesized (I1); the caller resolves it.
A designed voice is a substitute persona, never presented as a clone (I8).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional, Protocol

from starlette.requests import HTTPConnection

from config import Settings
from errors import AppError

logger = logging.getLogger("ps16.tts")

OUTPUT_FORMAT = "mp3_44100_128"


@dataclass(frozen=True)
class VoiceInfo:
    voice_id: str
    name: str
    category: Optional[str] = None


class SpeechSynthesizer(Protocol):
    def stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]: ...

    async def list_voices(self) -> list[VoiceInfo]: ...

    async def clone_voice(self, name: str, sample: bytes, filename: str, content_type: Optional[str]) -> str: ...

    async def design_voice(self, name: str, description: str) -> str: ...


def _upstream(exc: Exception) -> AppError:
    status = getattr(exc, "status_code", None)
    if status == 401:
        logger.error("ElevenLabs rejected the credentials - check ELEVENLABS_API_KEY")
    else:
        logger.error("ElevenLabs call failed: %s (status=%s)", type(exc).__name__, status)
    return AppError(502, "upstream_error", "Voice provider request failed")


class ElevenLabsSynthesizer:
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

    async def stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]:
        client = self._get_client()
        try:
            async for chunk in client.text_to_speech.stream(
                voice_id=voice_id, text=text, model_id=self._s.tts_model, output_format=OUTPUT_FORMAT
            ):
                if chunk:
                    yield chunk
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc

    async def list_voices(self) -> list[VoiceInfo]:
        client = self._get_client()
        try:
            resp = await client.voices.search()
            return [
                VoiceInfo(v.voice_id, getattr(v, "name", "") or "", getattr(v, "category", None))
                for v in resp.voices
            ]
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc

    async def clone_voice(self, name: str, sample: bytes, filename: str, content_type: Optional[str]) -> str:
        """Instant Voice Cloning; the sample goes straight from memory to the provider."""
        client = self._get_client()
        try:
            voice = await client.voices.ivc.create(name=name, files=[(filename, sample, content_type)])
            return voice.voice_id
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc

    async def design_voice(self, name: str, description: str) -> str:
        """Voice Design: design() returns previews, create() turns the first into a saved voice."""
        client = self._get_client()
        try:
            previews = await client.text_to_voice.design(voice_description=description)
            if not previews.previews:
                raise RuntimeError("no voice previews returned")
            voice = await client.text_to_voice.create(
                voice_name=name,
                voice_description=description,
                generated_voice_id=previews.previews[0].generated_voice_id,
            )
            return voice.voice_id
        except AppError:
            raise
        except Exception as exc:
            raise _upstream(exc) from exc


def get_synthesizer(request: HTTPConnection) -> SpeechSynthesizer:
    return ElevenLabsSynthesizer(request.app.state.settings)
