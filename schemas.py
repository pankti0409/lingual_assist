"""Shared Pydantic models (M0: error model and /health)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str
    details: Optional[Any] = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class ServicesStatus(BaseModel):
    elevenlabs: bool
    groq: bool


class ModelsInfo(BaseModel):
    llm: str
    tts: str
    scribe_batch: str
    scribe_realtime: str


class AssetsStatus(BaseModel):
    face_landmarker: bool
    gesture_recognizer: bool


class HealthResponse(BaseModel):
    status: str
    python: str
    services: ServicesStatus
    models: ModelsInfo
    assets: AssetsStatus
