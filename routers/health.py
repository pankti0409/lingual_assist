"""GET /health - booleans mean "configured"; never return key material."""
from __future__ import annotations

import platform

from fastapi import APIRouter, Request

from config import Settings
from schemas import AssetsStatus, HealthResponse, ModelsInfo, ServicesStatus

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    s: Settings = request.app.state.settings
    return HealthResponse(
        status="ok",
        python=platform.python_version(),
        services=ServicesStatus(elevenlabs=bool(s.elevenlabs_api_key), groq=bool(s.groq_api_key)),
        models=ModelsInfo(
            llm=s.llm_model,
            tts=s.tts_model,
            scribe_batch=s.scribe_batch_model,
            scribe_realtime=s.scribe_realtime_model,
        ),
        assets=AssetsStatus(
            face_landmarker=(s.assets_dir / "face_landmarker.task").is_file(),
            gesture_recognizer=(s.assets_dir / "gesture_recognizer.task").is_file(),
        ),
    )
