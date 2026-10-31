"""In-memory proposals, visible only inside their own session (MODULE_SPECS "Proposal")."""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from pydantic import BaseModel

from schemas import FusionResult
from state.sessions import Session

ProposalState = Literal["pending", "confirmed", "edited_confirmed", "rejected", "clarification_requested"]


class Proposal(BaseModel):
    proposal_id: str
    session_id: str
    evidence_timestamp_ms: int
    fusion: FusionResult
    state: ProposalState
    created_ms: int


class ProposalStore:
    def __init__(self) -> None:
        self._by_session: dict[str, dict[str, Proposal]] = {}

    def add(self, session: Session, evidence_timestamp_ms: int, fusion: FusionResult) -> Proposal:
        proposal = Proposal(
            proposal_id=uuid.uuid4().hex,
            session_id=session.session_id,
            evidence_timestamp_ms=evidence_timestamp_ms,
            fusion=fusion,
            state="pending",
            created_ms=session.clock.now_ms(),
        )
        self._by_session.setdefault(session.session_id, {})[proposal.proposal_id] = proposal
        return proposal

    def get(self, session_id: str, proposal_id: str) -> Optional[Proposal]:
        """A proposal id from another session is simply not found."""
        return self._by_session.get(session_id, {}).get(proposal_id)

    def list(self, session_id: str) -> list[Proposal]:
        return list(self._by_session.get(session_id, {}).values())

    def close_session(self, session: Session) -> None:
        """Session cleanup hook."""
        self._by_session.pop(session.session_id, None)
