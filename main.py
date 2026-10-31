"""App factory (blueprint §06 structure)."""
from __future__ import annotations

from fastapi import FastAPI

from clock import Clock, SystemClock
from config import Settings, load_settings
from errors import install_error_handlers
from logging_setup import configure_logging
from middleware import RequestIdMiddleware
from routers import evidence, fusion, health, history, metrics, proposals, scribe, sessions, turns, vision, voice
from services.vision import VisionRegistry
from state.metrics import MetricsStore
from state.proposals import ProposalStore
from state.sessions import SessionStore
from state.speaklog import SpeakLog


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    configure_logging()
    app = FastAPI(title="PS-16 Multimodal Live Conversation Assistant")
    app.state.settings = settings if settings is not None else load_settings()
    app.state.clock = clock if clock is not None else SystemClock()
    app.state.sessions = SessionStore(app.state.clock, app.state.settings.history_window_turns)
    app.state.vision = VisionRegistry(app.state.settings)
    app.state.sessions.register_cleanup(app.state.vision.close_session)
    app.state.proposals = ProposalStore()
    app.state.sessions.register_cleanup(app.state.proposals.close_session)
    app.state.metrics = MetricsStore()
    app.state.sessions.register_cleanup(app.state.metrics.close_session)
    app.state.speaklog = SpeakLog()
    app.state.sessions.register_cleanup(app.state.speaklog.close_session)
    install_error_handlers(app)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    app.include_router(sessions.router)
    app.include_router(history.router)
    app.include_router(vision.router)
    app.include_router(scribe.router)
    app.include_router(evidence.router)
    app.include_router(fusion.router)
    app.include_router(proposals.router)
    app.include_router(voice.router)
    app.include_router(turns.router)
    app.include_router(metrics.router)
    return app


app = create_app()
