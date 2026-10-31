"""Vision endpoints (blueprint §04-B/C). Clients must send un-mirrored frames (see README)."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, WebSocket
from pydantic import BaseModel

from errors import AppError
from logging_setup import get_request_id
from services.consent import ensure_consent, get_session, require_consent
from services.vision import (
    GESTURE_LABELS,
    MAX_MEANING_CHARS,
    BackendFactory,
    Cue,
    get_backend_factory,
    process_frame,
)
from state.sessions import Session

logger = logging.getLogger("ps16.vision")
router = APIRouter(tags=["vision"])


class FrameResponse(Cue):
    mirrored: Optional[bool] = None  # echoed only; never corrected for


class CuesResponse(BaseModel):
    cue: Optional[Cue] = None
    stale: bool = False


class GestureMapResponse(BaseModel):
    gesture_map: dict[str, str]


def _check_size(n: int, limit: int) -> None:
    if n > limit:
        raise AppError(413, "too_large", f"Frame exceeds {limit} bytes")


@router.post("/sessions/{session_id}/vision/frame", response_model=FrameResponse)
async def post_frame(
    request: Request,
    mirrored: Optional[bool] = Query(None),
    session: Session = Depends(require_consent("face_capture")),
    factory: BackendFactory = Depends(get_backend_factory),
) -> FrameResponse:
    """Single frame, raw image body (image/jpeg, image/png, octet-stream) or multipart field `file`."""
    limit = request.app.state.settings.max_frame_bytes
    declared = request.headers.get("content-length", "")
    if declared.isdigit():
        _check_size(int(declared), limit + 4096)  # multipart overhead
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise AppError(422, "validation_error", "Multipart field 'file' is required")
        data = await upload.read()
        raw_m = form.get("mirrored")
        if mirrored is None and isinstance(raw_m, str):
            mirrored = raw_m.strip().lower() in ("1", "true", "yes")
    else:
        data = await request.body()
    _check_size(len(data), limit)
    vs = request.app.state.vision.for_session(session.session_id)
    cue = await process_frame(vs, session, data, factory, "image")
    assert cue is not None  # IMAGE mode always yields an observation
    return FrameResponse(**cue.model_dump(), mirrored=mirrored)


@router.get("/sessions/{session_id}/vision/cues", response_model=CuesResponse)
async def get_cues(request: Request, session: Session = Depends(require_consent("face_capture"))) -> CuesResponse:
    vs = request.app.state.vision.for_session(session.session_id)
    cue = vs.tracker.current(session.clock.now_ms(), vs.gesture_map)
    return CuesResponse(cue=cue, stale=cue is None and vs.tracker.last_timestamp_ms is not None)


@router.put("/sessions/{session_id}/gesture-map", response_model=GestureMapResponse)
async def put_gesture_map(
    body: dict[str, str], request: Request, session: Session = Depends(get_session)
) -> GestureMapResponse:
    """Replace the per-session gesture meanings (I7)."""
    cleaned: dict[str, str] = {}
    for label, meaning in body.items():
        if label not in GESTURE_LABELS:
            raise AppError(422, "validation_error", f"Unknown gesture label '{label}'", {"allowed": list(GESTURE_LABELS)})
        meaning = meaning.strip()
        if not meaning or len(meaning) > MAX_MEANING_CHARS:
            raise AppError(422, "validation_error", f"Meaning for '{label}' must be 1-{MAX_MEANING_CHARS} characters")
        cleaned[label] = meaning
    request.app.state.vision.for_session(session.session_id).gesture_map = cleaned
    return GestureMapResponse(gesture_map=cleaned)


@router.websocket("/ws/sessions/{session_id}/vision")
async def vision_ws(
    ws: WebSocket, session_id: str, factory: BackendFactory = Depends(get_backend_factory)
) -> None:
    """Binary image frames in, cue JSON out. Latest frame wins: if processing falls behind,
    older unprocessed frames are dropped, never queued."""
    app = ws.app
    await ws.accept()
    session = app.state.sessions.get(session_id)
    try:
        if session is None:
            raise AppError(404, "not_found", "Session not found")
        ensure_consent(session, "face_capture")
    except AppError as exc:
        await _send_error(ws, exc)
        await ws.close(code=1008)
        return

    settings = app.state.settings
    vs = app.state.vision.for_session(session_id)
    slot: list[tuple[bytes, int]] = []  # holds at most one pending frame
    wake = asyncio.Event()
    done = asyncio.Event()

    async def reader() -> None:
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                data = msg.get("bytes")
                if data is None:
                    continue
                if len(data) > settings.max_frame_bytes:
                    await _send_error(ws, AppError(413, "too_large", "Frame too large"))
                    continue
                if slot:
                    vs.dropped_frames += 1
                slot[:] = [(data, session.clock.now_ms())]
                wake.set()
        finally:
            done.set()
            wake.set()

    async def processor() -> None:
        while True:
            await wake.wait()
            wake.clear()
            if not slot:
                if done.is_set():
                    return
                continue
            data, ts = slot.pop()
            try:
                if app.state.sessions.get(session_id) is not session:
                    await ws.close(code=1008)
                    return
                ensure_consent(session, "face_capture")  # consent can be withdrawn mid-stream
                cue = await process_frame(vs, session, data, factory, "live", ts)
                await ws.send_json({"cue": cue.model_dump() if cue else None, "dropped_frames": vs.dropped_frames})
            except AppError as exc:
                await _send_error(ws, exc)
                if exc.status in (403, 503):
                    await ws.close(code=1008)
                    return

    tasks = [asyncio.create_task(reader()), asyncio.create_task(processor())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t


async def _send_error(ws: WebSocket, exc: AppError) -> None:
    with contextlib.suppress(Exception):
        await ws.send_json(
            {"error": {"code": exc.code, "message": exc.message, "request_id": get_request_id(), "details": exc.details}}
        )
