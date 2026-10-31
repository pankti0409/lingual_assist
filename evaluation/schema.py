"""Scenario schema for the evaluation set (blueprint §07 "Minimum evaluation set")."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas import Language

Group = Literal["clear", "atypical", "gesture", "context", "language", "negative"]

# Minimum cases per group required by the blueprint / MODULE_SPECS M10.
MIN_PER_GROUP: dict[str, int] = {"clear": 5, "atypical": 5, "gesture": 5, "context": 5, "language": 3, "negative": 4}


class ScenarioContextTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    speaker: Literal["patient", "partner"]
    text: str


class ScenarioGesture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    score: float = Field(ge=0, le=1)


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    group: Group
    language: Language
    simulated: bool  # True = deliberately atypical/simulated speech (I8: labelled as such)
    context: list[ScenarioContextTurn]
    patient_audio_path: Optional[str] = None  # recorded by the team; relative to the project root
    reference_transcript: str  # manually checked transcript (WER reference)
    injected_transcript: str  # mock mode only: stands in for ASR output
    gesture: Optional[ScenarioGesture] = None
    mouth_activity: bool = False
    expected_intent: str
    intent_aliases: list[str] = Field(default_factory=list)
    expected_clarification: bool = False

    @model_validator(mode="after")
    def _checks(self) -> "Scenario":
        if self.group == "atypical" and not self.simulated:
            raise ValueError("atypical cases must be flagged simulated")
        if len(self.context) > 6:
            raise ValueError("context longer than the 6-turn window")
        return self


class ScenarioSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = 1
    note: str = ""
    cases: list[Scenario]

    @model_validator(mode="after")
    def _unique_and_counts(self) -> "ScenarioSet":
        ids = [c.id for c in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate scenario ids")
        return self


def load_scenarios(path: Path) -> ScenarioSet:
    return ScenarioSet.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))


def group_counts(cases: list[Scenario]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in cases:
        counts[c.group] = counts.get(c.group, 0) + 1
    return counts
