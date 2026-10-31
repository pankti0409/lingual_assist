"""Conversation history + typed-turn endpoints (blueprint §03 step 04)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, field_validator

from schemas import Language, Speaker, Turn
from services.consent import get_session
from state.sessions import Session

router = APIRouter(prefix="/sessions/{session_id}", tags=["conversation"])

MAX_TEXT_CHARS = 1000


class TextTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker: Speaker
    text: str
    language: Optional[Language] = None

    @field_validator("text")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        if len(v) > MAX_TEXT_CHARS:
            raise ValueError(f"text must be at most {MAX_TEXT_CHARS} characters")
        return v


class HistoryResponse(BaseModel):
    turns: list[Turn]


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    limit: Optional[int] = Query(None, ge=1, le=200), session: Session = Depends(get_session)
) -> HistoryResponse:
    return HistoryResponse(turns=session.conversation.recent(limit))


@router.post("/turns/text", response_model=Turn, status_code=201)
async def add_text_turn(body: TextTurnRequest, session: Session = Depends(get_session)) -> Turn:
    async with session.lock:
        return session.conversation.add_turn(body.speaker, body.text, body.language or session.language, "typed")
