"""Session + consent endpoints (blueprint §01 "Consent")."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from services.consent import get_session, get_store
from state.sessions import Language, Session, VoiceMode

router = APIRouter(prefix="/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Language = "en"
    voice_mode: VoiceMode = "none"


class ConsentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_recording: bool = False
    face_capture: bool = False
    voice_cloning: bool = False
    demo_use: bool = False


class ConsentResponse(ConsentRequest):
    recorded_ms: Optional[int] = None
    recorded_at: Optional[str] = None


class SessionResponse(BaseModel):
    session_id: str
    language: Language
    voice_mode: VoiceMode
    created_at: str
    consent: ConsentResponse


def _to_response(s: Session) -> SessionResponse:
    c = s.consent
    return SessionResponse(
        session_id=s.session_id,
        language=s.language,
        voice_mode=s.voice_mode,
        created_at=s.created_at,
        consent=ConsentResponse(
            audio_recording=c.audio_recording,
            face_capture=c.face_capture,
            voice_cloning=c.voice_cloning,
            demo_use=c.demo_use,
            recorded_ms=c.recorded_ms,
            recorded_at=c.recorded_at,
        ),
    )


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(request: Request, body: CreateSessionRequest | None = None) -> SessionResponse:
    body = body or CreateSessionRequest()
    return _to_response(get_store(request).create(body.language, body.voice_mode))


@router.post("/{session_id}/consent", response_model=SessionResponse)
async def set_consent(
    body: ConsentRequest, request: Request, session: Session = Depends(get_session)
) -> SessionResponse:
    async with session.lock:
        get_store(request).set_consent(session, body.model_dump())
    return _to_response(session)


@router.get("/{session_id}", response_model=SessionResponse)
async def read_session(session: Session = Depends(get_session)) -> SessionResponse:
    return _to_response(session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(request: Request, session: Session = Depends(get_session)) -> None:
    get_store(request).delete(session.session_id)
