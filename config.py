"""Settings loaded from the environment / .env (blueprint §06 setup).

Tunables are STARTING values, not validated results (CLAUDE.md).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict

BASE_DIR = Path(__file__).resolve().parent


class SettingsError(ValueError):
    """Raised at startup when an environment variable is invalid."""


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Secrets (I9): never logged or returned.
    elevenlabs_api_key: str = ""
    groq_api_key: str = ""

    llm_model: str = "openai/gpt-oss-120b"
    default_voice_id: str = ""  # optional labelled default voice (M8); empty = none
    tts_model: str = "eleven_flash_v2_5"
    scribe_batch_model: str = "scribe_v2"
    scribe_realtime_model: str = "scribe_v2_realtime"

    history_window_turns: int = 6
    cue_max_age_ms: int = 1500
    gesture_min_score: float = 0.6
    gesture_stability_frames: int = 3
    mouth_window_ms: int = 1000
    head_nod_window_ms: int = 1500
    vision_target_fps: int = 5
    max_audio_bytes: int = 20_000_000
    max_frame_bytes: int = 2_000_000
    llm_reasoning_effort: str = "low"
    llm_max_completion_tokens: int = 1024
    llm_temperature: float = 0.2
    llm_timeout_s: float = 10

    assets_dir: Path = BASE_DIR / "assets"
    logs_dir: Path = BASE_DIR / "logs"

    def __repr__(self) -> str:  # keep secrets out of accidental logging
        return "Settings(<redacted>)"

    __str__ = __repr__


# env var name -> (field, caster)
_ENV_FIELDS: dict[str, tuple[str, type]] = {
    "ELEVENLABS_API_KEY": ("elevenlabs_api_key", str),
    "GROQ_API_KEY": ("groq_api_key", str),
    "LLM_MODEL": ("llm_model", str),
    "DEFAULT_VOICE_ID": ("default_voice_id", str),
    "TTS_MODEL": ("tts_model", str),
    "SCRIBE_BATCH_MODEL": ("scribe_batch_model", str),
    "SCRIBE_REALTIME_MODEL": ("scribe_realtime_model", str),
    "HISTORY_WINDOW_TURNS": ("history_window_turns", int),
    "CUE_MAX_AGE_MS": ("cue_max_age_ms", int),
    "GESTURE_MIN_SCORE": ("gesture_min_score", float),
    "GESTURE_STABILITY_FRAMES": ("gesture_stability_frames", int),
    "MOUTH_WINDOW_MS": ("mouth_window_ms", int),
    "HEAD_NOD_WINDOW_MS": ("head_nod_window_ms", int),
    "VISION_TARGET_FPS": ("vision_target_fps", int),
    "MAX_AUDIO_BYTES": ("max_audio_bytes", int),
    "MAX_FRAME_BYTES": ("max_frame_bytes", int),
    "LLM_REASONING_EFFORT": ("llm_reasoning_effort", str),
    "LLM_MAX_COMPLETION_TOKENS": ("llm_max_completion_tokens", int),
    "LLM_TEMPERATURE": ("llm_temperature", float),
    "LLM_TIMEOUT_S": ("llm_timeout_s", float),
    "ASSETS_DIR": ("assets_dir", Path),
    "LOGS_DIR": ("logs_dir", Path),
}


def load_settings(env: Mapping[str, str] | None = None, *, use_dotenv: bool = True) -> Settings:
    """Build Settings from `env` (default: os.environ after loading .env).

    Invalid numeric values raise SettingsError naming the variable (M0-T04).
    """
    if env is None:
        if use_dotenv:
            load_dotenv(BASE_DIR / ".env")
        env = os.environ
    values: dict[str, object] = {}
    for name, (field, cast) in _ENV_FIELDS.items():
        raw = env.get(name)
        if raw is None or raw.strip() == "":
            continue
        raw = raw.strip()
        try:
            values[field] = raw if cast is str else cast(raw)
        except ValueError as exc:
            raise SettingsError(
                f"Invalid value for environment variable {name}: expected {cast.__name__}"
            ) from exc
    settings = Settings(**values)  # type: ignore[arg-type]
    if not 4 <= settings.history_window_turns <= 6:
        raise SettingsError("Invalid value for environment variable HISTORY_WINDOW_TURNS: allowed 4-6")
    return settings
