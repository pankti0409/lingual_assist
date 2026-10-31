"""Shared Pydantic models: /health and the cross-module contracts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


# ---- Shared contracts (MODULE_SPECS "Shared contracts") ----
Speaker = Literal["patient", "partner"]
Language = Literal["en", "hi", "mixed"]
TurnSource = Literal["scribe_batch", "scribe_realtime", "typed"]


class Turn(BaseModel):
    turn_id: str
    speaker: Speaker
    text: str
    language: Language
    timestamp_ms: int
    source: TurnSource


class FusionResult(BaseModel):
    """LLM output contract (blueprint §05 "Required structured response")."""

    model_config = ConfigDict(extra="forbid", strict=True)  # strict: no "no" -> False coercion

    intent: str = Field(max_length=60, pattern=r"^[a-z][a-z0-9_]*$")
    candidate_replies: list[str]
    clarification_required: bool
    reasoning_summary: str = Field(max_length=300)

    @field_validator("candidate_replies")
    @classmethod
    def _replies(cls, v: list[str]) -> list[str]:
        if len(v) > 3:
            raise ValueError("at most 3 candidate replies")
        for r in v:
            if not r.strip():
                raise ValueError("candidate replies must not be empty")
            if len(r) > 200:
                raise ValueError("candidate reply longer than 200 characters")
        return v

    @model_validator(mode="after")
    def _count(self) -> "FusionResult":
        if not self.clarification_required and not 2 <= len(self.candidate_replies) <= 3:
            raise ValueError("2-3 candidate replies are required when clarification_required is false")
        return self
