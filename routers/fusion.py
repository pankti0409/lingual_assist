"""POST /sessions/{id}/fuse (blueprint §04-D, §05)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from services.consent import get_session
from services.evidence import EvidencePacket
from services.fusion import IntentRanker, get_ranker
from services.pipeline import run_fusion
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
    run = await run_fusion(request.app, session, ranker, body.turn_id, body.include_visual_cues)
    return FuseResponse(
        proposal=run.proposal,
        evidence=run.packet,
        clarification_message=run.clarification_message,
        stage_ms=run.stage_ms,
    )
