"""Voice endpoints: speak a CONFIRMED message, list/clone/design voices (blueprint §04-E)."""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, field_validator

from clock import Timer
from errors import AppError
from services.consent import ensure_consent, get_session
from services.tts import SpeechSynthesizer, get_synthesizer
from state.sessions import Session
from state.speaklog import SpeakRecord

logger = logging.getLogger("ps16.tts")
router = APIRouter(tags=["voice"])


class SpeakRequest(BaseModel):
    """Only a confirmed_id - the endpoint never accepts free text (I1)."""

    model_config = ConfigDict(extra="forbid")
    confirmed_id: str


class VoiceOut(BaseModel):
    voice_id: str
    name: str
    category: Optional[str] = None


class VoicesResponse(BaseModel):
    voices: list[VoiceOut]


class DesignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    description: str
    name: str = "PS16 designed voice"

    @field_validator("description", "name")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        if len(v) > 1000:
            raise ValueError("must be at most 1000 characters")
        return v


class VoiceSetResponse(BaseModel):
    session_id: str
    voice_id: str
    name: str
    persona: str  # "designed_voice" | "cloned_voice"
    note: str


def _voice_for(session: Session, default_voice_id: str) -> tuple[str, str]:
    """(voice_id, persona) for the session; 409 when none is selected."""
    if session.voice_id:
        return session.voice_id, "cloned_voice" if session.voice_mode == "clone" else "designed_voice"
    if default_voice_id:
        return default_voice_id, "default_voice"
    raise AppError(409, "invalid_state", "No voice selected for this session")


@router.post("/sessions/{session_id}/speak")
async def speak(
    body: SpeakRequest,
    request: Request,
    session: Session = Depends(get_session),
    synth: SpeechSynthesizer = Depends(get_synthesizer),
) -> StreamingResponse:
    state = request.app.state
    # I1: the text comes ONLY from a stored confirmed message.
    msg = state.proposals.get_confirmed(session.session_id, body.confirmed_id)
    if msg is None:
        if state.proposals.get(session.session_id, body.confirmed_id) is not None:
            raise AppError(409, "invalid_state", "That id is a proposal, not a confirmed message")
        raise AppError(404, "not_found", "Confirmed message not found")
    voice_id, persona = _voice_for(session, state.settings.default_voice_id)

    timer = Timer(state.clock)
    agen = synth.stream(msg.text, voice_id)
    first = b""
    try:
        async for chunk in agen:
            if chunk:
                first = chunk
                break
    except AppError:
        raise
    except Exception as exc:
        logger.error("TTS stream failed: %s", type(exc).__name__)
        raise AppError(502, "upstream_error", "Voice provider request failed") from exc
    if not first:
        raise AppError(502, "upstream_error", "Voice provider returned no audio")
    first_ms = max(0, timer.elapsed_ms())

    state.speaklog.add(
        session.session_id,
        SpeakRecord(msg.confirmed_id, session.clock.now_ms(), first_ms, persona),
    )
    logger.info("speak confirmed_id=%s chars=%d tts_first_audio_ms=%d persona=%s", msg.confirmed_id, len(msg.text), first_ms, persona)

    async def body_iter() -> AsyncIterator[bytes]:
        try:
            yield first
            async for chunk in agen:
                yield chunk
        except Exception as exc:  # headers are already sent; all we can do is stop and log
            logger.error("TTS stream interrupted: %s", type(exc).__name__)
        finally:
            aclose = getattr(agen, "aclose", None)
            if aclose is not None:
                await aclose()

    return StreamingResponse(
        body_iter(),
        media_type="audio/mpeg",
        headers={
            "X-First-Audio-Ms": str(first_ms),
            "X-Confirmed-Id": msg.confirmed_id,
            "X-Voice-Persona": persona,
            "X-TTS-Model": state.settings.tts_model,
            "X-Subtitle-Text": quote(msg.text, safe=""),  # percent-encoded UTF-8 (headers are latin-1)
        },
    )


@router.get("/voices", response_model=VoicesResponse)
async def list_voices(synth: SpeechSynthesizer = Depends(get_synthesizer)) -> VoicesResponse:
    voices = await synth.list_voices()
    return VoicesResponse(voices=[VoiceOut(voice_id=v.voice_id, name=v.name, category=v.category) for v in voices])


@router.post("/voices/clone", response_model=VoiceSetResponse)
async def clone_voice(
    request: Request,
    sample: UploadFile = File(...),
    name: str = Form(...),
    session_id: str = Form(...),
    synth: SpeechSynthesizer = Depends(get_synthesizer),
) -> VoiceSetResponse:
    session = get_session(session_id, request)
    try:
        ensure_consent(session, "voice_cloning")  # I8: before touching the sample
        name = name.strip()
        if not name:
            raise AppError(422, "validation_error", "name must not be empty")
        limit = request.app.state.settings.max_audio_bytes
        data = await sample.read()
        if len(data) > limit:
            raise AppError(413, "too_large", f"Sample exceeds {limit} bytes")
        if not data:
            raise AppError(422, "validation_error", "Voice sample is empty")
        voice_id = await synth.clone_voice(name, data, sample.filename or "sample", sample.content_type)
    finally:
        await sample.close()
    session.voice_id, session.voice_mode = voice_id, "clone"
    return VoiceSetResponse(
        session_id=session_id,
        voice_id=voice_id,
        name=name,
        persona="cloned_voice",
        note="Cloned from a consented sample.",
    )


@router.post("/voices/design", response_model=VoiceSetResponse)
async def design_voice(
    body: DesignRequest, request: Request, synth: SpeechSynthesizer = Depends(get_synthesizer)
) -> VoiceSetResponse:
    session = get_session(body.session_id, request)
    voice_id = await synth.design_voice(body.name, body.description)
    session.voice_id, session.voice_mode = voice_id, "designed"
    return VoiceSetResponse(
        session_id=body.session_id,
        voice_id=voice_id,
        name=body.name,
        persona="designed_voice",
        note="A designed substitute voice, not a clone of the patient's own voice.",
    )
