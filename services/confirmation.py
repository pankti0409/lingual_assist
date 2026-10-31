"""Patient-confirmation state machine (I1: nothing is speakable before the patient confirms).

pending -> confirmed | edited_confirmed | rejected | clarification_requested   (all terminal)
Repeating the SAME action is idempotent; a DIFFERENT action on a terminal proposal is 409.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

from errors import AppError
from state.proposals import ConfirmedMessage, Proposal, ProposalStore
from state.sessions import Session


@dataclass(frozen=True)
class ActionResult:
    proposal: Proposal
    confirmed: Optional[ConfirmedMessage] = None
    re_fuse_available: Optional[bool] = None
    effort_actions: int = 0


def _conflict(p: Proposal, action: str) -> AppError:
    return AppError(409, "invalid_state", f"Proposal is already '{p.state}'; cannot {action}")


class ConfirmationService:
    def __init__(self, store: ProposalStore) -> None:
        self._store = store

    def _get(self, session: Session, proposal_id: str) -> Proposal:
        p = self._store.get(session.session_id, proposal_id)
        if p is None:
            raise AppError(404, "not_found", "Proposal not found")
        return p

    def _issue(self, session: Session, p: Proposal, text: str, how: str, index: Optional[int]) -> ConfirmedMessage:
        """The single place a confirmed_id is created. Only a pending proposal may reach it (I1)."""
        if p.state != "pending":
            raise _conflict(p, "confirm")
        effort = self._store.bump_effort(session.session_id, p.turn_id)
        msg = ConfirmedMessage(
            confirmed_id=uuid.uuid4().hex,
            proposal_id=p.proposal_id,
            text=text,
            how=how,  # type: ignore[arg-type]
            candidate_index=index,
            effort_actions=effort,
        )
        self._store.add_confirmed(session.session_id, msg)
        self._store.close_chain(session.session_id, p.turn_id)  # message confirmed: effort chain ends
        p.state = "confirmed" if how == "candidate" else "edited_confirmed"
        return msg

    def _existing(self, session: Session, p: Proposal) -> ConfirmedMessage:
        for m in self._store.list_confirmed(session.session_id):
            if m.proposal_id == p.proposal_id:
                return m
        raise AppError(409, "invalid_state", "Proposal has no confirmed message")  # unreachable by construction

    def confirm(self, session: Session, proposal_id: str, candidate_index: int) -> ActionResult:
        p = self._get(session, proposal_id)
        if p.state == "confirmed":
            m = self._existing(session, p)
            if m.candidate_index == candidate_index:
                return ActionResult(p, m, None, m.effort_actions)  # idempotent repeat
            raise _conflict(p, "confirm a different candidate")
        if p.state != "pending":
            raise _conflict(p, "confirm")
        replies = p.fusion.candidate_replies
        if not replies:
            raise AppError(409, "invalid_state", "Proposal has no candidates to confirm; edit or clarify instead")
        if not 0 <= candidate_index < len(replies):
            raise AppError(422, "validation_error", f"candidate_index must be 0-{len(replies) - 1}")
        m = self._issue(session, p, replies[candidate_index], "candidate", candidate_index)
        return ActionResult(p, m, None, m.effort_actions)

    def edit(self, session: Session, proposal_id: str, text: str) -> ActionResult:
        p = self._get(session, proposal_id)
        if p.state == "edited_confirmed":
            m = self._existing(session, p)
            if m.text == text:
                return ActionResult(p, m, None, m.effort_actions)
            raise _conflict(p, "edit to different text")
        if p.state != "pending":
            raise _conflict(p, "edit")
        m = self._issue(session, p, text, "edited", None)  # exact patient-authored text
        return ActionResult(p, m, None, m.effort_actions)

    def reject(self, session: Session, proposal_id: str) -> ActionResult:
        p = self._get(session, proposal_id)
        if p.state == "rejected":
            return ActionResult(p, None, True, self._store.effort(session.session_id, p.turn_id))
        if p.state != "pending":
            raise _conflict(p, "reject")
        effort = self._store.bump_effort(session.session_id, p.turn_id)
        p.state = "rejected"
        return ActionResult(p, None, True, effort)

    def clarify(self, session: Session, proposal_id: str) -> ActionResult:
        p = self._get(session, proposal_id)
        if p.state == "clarification_requested":
            return ActionResult(p, None, True, self._store.effort(session.session_id, p.turn_id))
        if p.state != "pending":
            raise _conflict(p, "request clarification")
        effort = self._store.bump_effort(session.session_id, p.turn_id)
        p.state = "clarification_requested"
        return ActionResult(p, None, True, effort)
