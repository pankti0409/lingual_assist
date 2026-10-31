"""Speech input endpoints: batch upload and realtime WebSocket (blueprint §04-A)."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, WebSocket
from pydantic import BaseModel

from clock import Timer
from errors import AppError
from logging_setup import get_request_id
from schemas import Language, Speaker, Turn
from services.consent import ensure_consent, require_consent
from services.pipeline import record_scribe
from services.scribe import RealtimeEvent, Transcriber, get_transcriber, scribe_language_code
from state.sessions import Session

logger = logging.getLogger("ps16.scribe")
router = APIRouter(tags=["speech"])


class TranscribeResponse(BaseModel):
    turn: Optional[Turn] = None  # None when Scribe heard nothing; nothing is stored then
    raw_text: str
    language_code: Optional[str] = None
    language_probability: Optional[float] = None
    duration_s: Optional[float] = None
    stage_ms: int  # time spent in the Scribe call, measured with the server clock


@router.post("/sessions/{session_id}/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    speaker: Speaker = Form(...),
    language: Optional[Language] = Form(None),
    session: Session = Depends(require_consent("audio_recording")),
    transcriber: Transcriber = Depends(get_transcriber),
) -> TranscribeResponse:
    limit = request.app.state.settings.max_audio_bytes
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit + 65536:  # multipart overhead
        raise AppError(413, "too_large", f"Audio exceeds {limit} bytes")
    data = await audio.read()
    if len(data) > limit:
        raise AppError(413, "too_large", f"Audio exceeds {limit} bytes")
    if not data:
        raise AppError(422, "validation_error", "Audio file is empty")

    lang = language or session.language
    timer = Timer(request.app.state.clock)
    result = await transcriber.transcribe(
        data, audio.filename or "audio", audio.content_type, scribe_language_code(lang)
    )
    stage_ms = max(0, timer.elapsed_ms())

    turn: Optional[Turn] = None
    if result.text.strip():
        async with session.lock:
            # RAW Scribe text, unmodified (needed for WER).
            turn = session.conversation.add_turn(speaker, result.text, lang, "scribe_batch")
        record_scribe(request.app, session, turn, stage_ms)
    return TranscribeResponse(
        turn=turn,
        raw_text=result.text,
        language_code=result.language_code,
        language_probability=result.language_probability,
        duration_s=result.duration_s,
        stage_ms=stage_ms,
    )


# ------------------------------------------------------------------ realtime
async def _send_error(ws: WebSocket, code: str, message: str) -> None:
    with contextlib.suppress(Exception):
        await ws.send_json({"type": "error", "code": code, "message": message, "request_id": get_request_id()})


@router.websocket("/ws/sessions/{session_id}/scribe")
async def scribe_ws(ws: WebSocket, session_id: str, transcriber: Transcriber = Depends(get_transcriber)) -> None:
    """Client: JSON start -> PCM16 16 kHz mono binary frames -> JSON commit ... -> JSON stop.
    Server: partial / committed / error events. Only committed text enters history."""
    app = ws.app
    settings = app.state.settings
    await ws.accept()
    session = app.state.sessions.get(session_id)
    try:
        if session is None:
            raise AppError(404, "not_found", "Session not found")
        ensure_consent(session, "audio_recording")
    except AppError as exc:
        await _send_error(ws, exc.code, exc.message)
        await ws.close(code=1008)
        return

    # --- start message
    try:
        start = json.loads(await ws.receive_text())
        if not isinstance(start, dict) or start.get("type") != "start":
            raise ValueError("first message must be {'type':'start', ...}")
        speaker = start.get("speaker")
        if speaker not in ("patient", "partner"):
            raise ValueError("speaker must be 'patient' or 'partner'")
        language = start.get("language", session.language)
        if language not in ("en", "hi", "mixed"):
            raise ValueError("language must be 'en', 'hi' or 'mixed'")
    except Exception as exc:  # bad JSON, binary instead of text, wrong fields, disconnect
        await _send_error(ws, "validation_error", f"Invalid start message: {exc}")
        await ws.close(code=1008)
        return

    queue: asyncio.Queue[RealtimeEvent] = asyncio.Queue()
    try:
        rt = await transcriber.open_realtime(scribe_language_code(language), queue.put_nowait)
    except AppError as exc:
        await _send_error(ws, exc.code, exc.message)
        await ws.close(code=1011 if exc.status == 502 else 1008)
        return

    async def emitter() -> None:
        while True:
            ev = await queue.get()
            if ev.kind == "error":
                await _send_error(ws, "upstream_error", "Speech-to-text provider reported an error")
                continue
            payload = {"type": ev.kind, "text": ev.text, "speaker": speaker, "timestamp_ms": session.clock.now_ms()}
            if ev.kind == "committed" and ev.text.strip():
                async with session.lock:
                    turn = session.conversation.add_turn(speaker, ev.text, language, "scribe_realtime")
                payload["turn_id"] = turn.turn_id
                payload["timestamp_ms"] = turn.timestamp_ms
            await ws.send_json(payload)

    emit_task = asyncio.create_task(emitter())
    received = 0
    try:
        await ws.send_json({"type": "started", "speaker": speaker, "language": language})
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if app.state.sessions.get(session_id) is not session:
                await _send_error(ws, "not_found", "Session ended")
                break
            try:
                ensure_consent(session, "audio_recording")  # consent can be withdrawn mid-stream
            except AppError as exc:
                await _send_error(ws, exc.code, exc.message)
                break
            if msg.get("bytes") is not None:
                received += len(msg["bytes"])
                if received > settings.max_audio_bytes:
                    await _send_error(ws, "too_large", "Audio stream exceeds the size limit")
                    break
                await rt.send_audio(msg["bytes"])
                continue
            try:
                ctrl = json.loads(msg.get("text") or "")
                kind = ctrl.get("type") if isinstance(ctrl, dict) else None
            except json.JSONDecodeError:
                kind = None
            if kind == "commit":
                await rt.commit()
            elif kind == "stop":
                break
            else:
                await _send_error(ws, "validation_error", "Expected binary audio, {'type':'commit'} or {'type':'stop'}")
    except AppError as exc:
        await _send_error(ws, exc.code, exc.message)
    finally:
        emit_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await emit_task
        await rt.close()
        with contextlib.suppress(Exception):
            await ws.close()
