"""POST /sessions/{id}/fuse (blueprint §04-D, §05)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from clock import Timer
from services.consent import get_session
from services.evidence import EvidencePacket, build_packet, resolve_patient_turn
from services.fusion import CLARIFICATION_MESSAGE, IntentRanker, get_ranker
from state.proposals import Proposal
from state.sessions import Session

logger = logging.getLogger("ps16.fusion")
router = APIRouter(tags=["fusion"])


class FuseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_id: Optional[str] = None
    include_visual_cues: bool = True


class FuseResponse(BaseModel):
    proposal: Proposal
    evidence: EvidencePacket
    clarification_message: Optional[str] = None
    stage_ms: int


@router.post("/sessions/{session_id}/fuse", response_model=FuseResponse)
async def fuse(
    request: Request,
    body: FuseRequest | None = None,
    session: Session = Depends(get_session),
    ranker: IntentRanker = Depends(get_ranker),
) -> FuseResponse:
    body = body or FuseRequest()
    turn = resolve_patient_turn(session, body.turn_id)
    vreg = request.app.state.vision
    packet = build_packet(
        session, turn, vreg.for_session(session.session_id) if vreg.has(session.session_id) else None,
        body.include_visual_cues,
    )
    timer = Timer(request.app.state.clock)
    fusion = await ranker.rank(packet)
    stage_ms = max(0, timer.elapsed_ms())
    logger.info("fusion stage_ms=%d clarification=%s", stage_ms, fusion.clarification_required)
    proposal = request.app.state.proposals.add(session, turn.turn_id, packet.timestamp_ms, fusion)
    return FuseResponse(
        proposal=proposal,
        evidence=packet,
        clarification_message=CLARIFICATION_MESSAGE if fusion.clarification_required else None,
        stage_ms=stage_ms,
    )
