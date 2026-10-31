"""GET /sessions/{id}/metrics - measured timings per message chain (I10: measured, never assumed)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from services.consent import get_session
from state.metrics import TurnMetrics
from state.sessions import Session

router = APIRouter(tags=["metrics"])


class MetricsResponse(BaseModel):
    turns: list[TurnMetrics]


@router.get("/sessions/{session_id}/metrics", response_model=MetricsResponse)
async def get_metrics(request: Request, session: Session = Depends(get_session)) -> MetricsResponse:
    return MetricsResponse(turns=request.app.state.metrics.list(session.session_id))
