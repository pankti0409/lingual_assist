"""In-memory proposals and confirmed messages, visible only inside their own session."""
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
    turn_id: str  # the patient turn this proposal interprets; also the effort-chain key (M7)
    evidence_timestamp_ms: int
    fusion: FusionResult
    state: ProposalState
    created_ms: int


class ConfirmedMessage(BaseModel):
    """The ONLY thing TTS may speak (I1)."""

    confirmed_id: str
    proposal_id: str
    text: str
    how: Literal["candidate", "edited"]
    candidate_index: Optional[int] = None
    effort_actions: int


class ProposalStore:
    def __init__(self) -> None:
        self._by_session: dict[str, dict[str, Proposal]] = {}
        self._confirmed: dict[str, dict[str, ConfirmedMessage]] = {}
        self._effort: dict[tuple[str, str], int] = {}  # (session, patient turn) -> patient actions so far

    def add(self, session: Session, turn_id: str, evidence_timestamp_ms: int, fusion: FusionResult) -> Proposal:
        proposal = Proposal(
            proposal_id=uuid.uuid4().hex,
            session_id=session.session_id,
            turn_id=turn_id,
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

    # ---- confirmed messages (written only by services.confirmation)
    def add_confirmed(self, session_id: str, msg: ConfirmedMessage) -> None:
        self._confirmed.setdefault(session_id, {})[msg.confirmed_id] = msg

    def get_confirmed(self, session_id: str, confirmed_id: str) -> Optional[ConfirmedMessage]:
        return self._confirmed.get(session_id, {}).get(confirmed_id)

    def list_confirmed(self, session_id: str) -> list[ConfirmedMessage]:
        return list(self._confirmed.get(session_id, {}).values())

    # ---- effort chains
    def bump_effort(self, session_id: str, turn_id: str) -> int:
        key = (session_id, turn_id)
        self._effort[key] = self._effort.get(key, 0) + 1
        return self._effort[key]

    def effort(self, session_id: str, turn_id: str) -> int:
        return self._effort.get((session_id, turn_id), 0)

    def close_chain(self, session_id: str, turn_id: str) -> None:
        self._effort.pop((session_id, turn_id), None)

    def close_session(self, session: Session) -> None:
        """Session cleanup hook."""
        sid = session.session_id
        self._by_session.pop(sid, None)
        self._confirmed.pop(sid, None)
        for key in [k for k in self._effort if k[0] == sid]:
            del self._effort[key]
