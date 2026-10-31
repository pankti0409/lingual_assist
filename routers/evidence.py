"""POST /sessions/{id}/evidence (blueprint §05)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from errors import AppError
from services.consent import get_session
from services.evidence import EvidencePacket, build_packet
from state.sessions import Session

router = APIRouter(tags=["evidence"])


class EvidenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_id: Optional[str] = None  # default: the latest patient turn
    include_visual_cues: bool = True  # False = ablation A (no cues), M10


@router.post("/sessions/{session_id}/evidence", response_model=EvidencePacket)
async def build_evidence(
    request: Request, body: EvidenceRequest | None = None, session: Session = Depends(get_session)
) -> EvidencePacket:
    body = body or EvidenceRequest()
    conv = session.conversation
    if body.turn_id is None:
        turn = conv.latest("patient")
        if turn is None:
            raise AppError(409, "invalid_state", "No patient turn yet")
    else:
        turn = conv.get(body.turn_id)
        if turn is None:
            raise AppError(404, "not_found", "Turn not found")
        if turn.speaker != "patient":
            raise AppError(422, "validation_error", "Evidence packets are built from a patient turn")
    vision = request.app.state.vision.for_session(session.session_id) if request.app.state.vision.has(session.session_id) else None
    return build_packet(session, turn, vision, body.include_visual_cues)
