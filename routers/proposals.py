"""Patient actions on proposals (blueprint §05 "Patient control is a core feature")."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from errors import AppError
from services.confirmation import ActionResult, ConfirmationService
from services.consent import get_session
from state.proposals import ConfirmedMessage, Proposal
from state.sessions import Session

router = APIRouter(prefix="/sessions/{session_id}", tags=["confirmation"])

MAX_EDIT_CHARS = 300


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_index: StrictInt = Field(ge=0)


class EditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be empty")
        if len(v) > MAX_EDIT_CHARS:
            raise ValueError(f"text must be at most {MAX_EDIT_CHARS} characters")
        return v


class ActionResponse(BaseModel):
    proposal: Proposal
    confirmed: Optional[ConfirmedMessage] = None
    re_fuse_available: Optional[bool] = None
    effort_actions: int


def _service(request: Request) -> ConfirmationService:
    return ConfirmationService(request.app.state.proposals)


def _out(r: ActionResult) -> ActionResponse:
    return ActionResponse(
        proposal=r.proposal, confirmed=r.confirmed, re_fuse_available=r.re_fuse_available, effort_actions=r.effort_actions
    )


@router.post("/proposals/{proposal_id}/confirm", response_model=ActionResponse)
async def confirm(
    proposal_id: str, body: ConfirmRequest, request: Request, session: Session = Depends(get_session)
) -> ActionResponse:
    async with session.lock:
        return _out(_service(request).confirm(session, proposal_id, body.candidate_index))


@router.post("/proposals/{proposal_id}/edit", response_model=ActionResponse)
async def edit(
    proposal_id: str, body: EditRequest, request: Request, session: Session = Depends(get_session)
) -> ActionResponse:
    async with session.lock:
        return _out(_service(request).edit(session, proposal_id, body.text))


@router.post("/proposals/{proposal_id}/reject", response_model=ActionResponse)
async def reject(proposal_id: str, request: Request, session: Session = Depends(get_session)) -> ActionResponse:
    async with session.lock:
        return _out(_service(request).reject(session, proposal_id))


@router.post("/proposals/{proposal_id}/clarify", response_model=ActionResponse)
async def clarify(proposal_id: str, request: Request, session: Session = Depends(get_session)) -> ActionResponse:
    async with session.lock:
        return _out(_service(request).clarify(session, proposal_id))


@router.get("/confirmed/{confirmed_id}", response_model=ConfirmedMessage)
async def get_confirmed(confirmed_id: str, request: Request, session: Session = Depends(get_session)) -> ConfirmedMessage:
    msg = request.app.state.proposals.get_confirmed(session.session_id, confirmed_id)
    if msg is None:
        raise AppError(404, "not_found", "Confirmed message not found")
    return msg
