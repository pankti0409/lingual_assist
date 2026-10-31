"""App factory (blueprint §06 structure)."""
from __future__ import annotations

from fastapi import FastAPI

from clock import Clock, SystemClock
from config import Settings, load_settings
from errors import install_error_handlers
from logging_setup import configure_logging
from middleware import RequestIdMiddleware
from routers import health


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    configure_logging()
    app = FastAPI(title="PS-16 Multimodal Live Conversation Assistant")
    app.state.settings = settings if settings is not None else load_settings()
    app.state.clock = clock if clock is not None else SystemClock()
    install_error_handlers(app)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    return app


app = create_app()
