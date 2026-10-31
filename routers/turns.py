"""POST /sessions/{id}/turn/finish - the user-triggered "finish speaking" (blueprint §03, §05)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from routers.fusion import FuseResponse
from services.consent import get_session
from services.fusion import IntentRanker, get_ranker
from services.pipeline import run_fusion
from state.sessions import Session

router = APIRouter(tags=["pipeline"])


class FinishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_visual_cues: bool = True  # False = audio-only ablation (M10)


@router.post("/sessions/{session_id}/turn/finish", response_model=FuseResponse)
async def finish_turn(
    request: Request,
    body: FinishRequest | None = None,
    session: Session = Depends(get_session),
    ranker: IntentRanker = Depends(get_ranker),
) -> FuseResponse:
    """Latest patient turn -> latest stable cues -> recent history -> evidence -> fusion -> proposal.

    The patient must still confirm (M7) before anything can be spoken (M8).
    """
    body = body or FinishRequest()
    run = await run_fusion(request.app, session, ranker, None, body.include_visual_cues)
    return FuseResponse(
        proposal=run.proposal,
        evidence=run.packet,
        clarification_message=run.clarification_message,
        stage_ms=run.stage_ms,
    )
