"""Session lookup and consent guard (I8: no capture/cloning/demo use without consent)."""
from __future__ import annotations

from typing import Callable

from fastapi import Request

from errors import AppError
from state.sessions import CONSENT_PURPOSES, Session, SessionStore


def get_store(request: Request) -> SessionStore:
    return request.app.state.sessions


def get_session(session_id: str, request: Request) -> Session:
    session = get_store(request).get(session_id)
    if session is None:
        raise AppError(404, "not_found", "Session not found")
    return session


def require_consent(purpose: str) -> Callable[[str, Request], Session]:
    """Dependency factory: 404 for unknown session, 403 `consent_required` naming the purpose."""
    if purpose not in CONSENT_PURPOSES:
        raise ValueError(f"unknown consent purpose: {purpose}")

    def dependency(session_id: str, request: Request) -> Session:
        session = get_session(session_id, request)
        if not session.consent.allows(purpose):
            raise AppError(
                403,
                "consent_required",
                f"Consent for '{purpose}' has not been given for this session",
                {"purpose": purpose},
            )
        return session

    return dependency
