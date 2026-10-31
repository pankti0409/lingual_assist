"""Intent fusion with an LLM (blueprint §04-D, §05 "Fusion logic").

The model ranks candidate meanings from the evidence packet ONLY; it never decides to speak.
Invalid output -> retry once -> clarification, never a guessed reply (I2).
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from pydantic import ValidationError
from starlette.requests import HTTPConnection

from config import Settings
from errors import AppError
from schemas import FusionResult
from services.evidence import EvidencePacket

logger = logging.getLogger("ps16.fusion")

CLARIFICATION_MESSAGE = "I did not understand - please choose, repeat or clarify."

LANGUAGE_STYLE = {
    "en": "English",
    "hi": "Hindi (Devanagari script)",
    "mixed": "the same Hindi–English mix the patient used",
}

SYSTEM_PROMPT = (
    "You help interpret the intended message of a person with a speech impairment. "
    "You receive one JSON evidence packet.\n"
    "Rules: Use ONLY the supplied evidence. Do not invent facts, names, needs or medical details. "
    "Do NOT diagnose any condition. Do NOT infer emotion or mood from visual cues. "
    "Visual cues are weak movement signals; a gesture's meaning is only what `gesture.meaning` states. "
    "The transcript may be partial, slurred or misrecognised — prefer interpretations consistent with "
    "BOTH the transcript and the recent conversation. "
    "If the evidence is insufficient, ambiguous or conflicting, set `clarification_required` to true. "
    "Write 2–3 short first-person replies the patient could say, in {language_style}. "
    "Return JSON only, matching the schema, no markdown."
)


def system_prompt(language: str) -> str:
    return SYSTEM_PROMPT.format(language_style=LANGUAGE_STYLE[language])


def build_messages(packet: EvidencePacket) -> list[dict[str, str]]:
    """Only the compact evidence packet is ever sent (I3)."""
    return [
        {"role": "system", "content": system_prompt(packet.language)},
        {"role": "user", "content": json.dumps(packet.model_dump(), ensure_ascii=False)},
    ]


def clarification_result(reason: str) -> FusionResult:
    return FusionResult(
        intent="unclear",
        candidate_replies=[],
        clarification_required=True,
        reasoning_summary=reason,
    )


def wire_schema() -> dict[str, Any]:
    """JSON schema for Groq `response_format`. Constraints the strict mode may not accept are
    dropped here; Pydantic re-validation is the real guard (VERIFIED_API_NOTES)."""
    schema = FusionResult.model_json_schema()
    drop = {"title", "description", "pattern", "maxLength", "minLength", "maxItems", "minItems"}

    def clean(node: Any) -> Any:
        if isinstance(node, dict):
            out = {k: clean(v) for k, v in node.items() if k not in drop or k == "properties"}
            return out
        if isinstance(node, list):
            return [clean(v) for v in node]
        return node

    schema = clean(schema)
    schema["additionalProperties"] = False
    schema["required"] = list(schema["properties"])
    return schema


@dataclass(frozen=True)
class Completion:
    content: str
    truncated: bool = False  # finish_reason == "length"


class ChatLLM(Protocol):
    async def complete(self, messages: list[dict[str, str]]) -> Completion: ...


class IntentRanker(Protocol):
    async def rank(self, packet: EvidencePacket) -> FusionResult: ...


class GroqChatLLM:
    """Adapter over the installed `groq` SDK. `client` is injectable for tests."""

    def __init__(self, settings: Settings, client: Any = None) -> None:
        self._s = settings
        self._client = client

    def _get_client(self) -> Any:
        if not self._s.groq_api_key:
            raise AppError(503, "not_configured", "GROQ_API_KEY is not configured")
        if self._client is None:
            from groq import AsyncGroq

            self._client = AsyncGroq(api_key=self._s.groq_api_key, timeout=self._s.llm_timeout_s, max_retries=0)
        return self._client

    async def complete(self, messages: list[dict[str, str]]) -> Completion:
        client = self._get_client()
        s = self._s
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=s.llm_model,
                    messages=messages,
                    temperature=s.llm_temperature,
                    reasoning_effort=s.llm_reasoning_effort,
                    max_completion_tokens=s.llm_max_completion_tokens,
                    response_format={
                        "type": "json_schema",
                        "json_schema": {"name": "fusion_result", "strict": True, "schema": wire_schema()},
                    },
                ),
                timeout=s.llm_timeout_s,
            )
            choice = resp.choices[0]
            return Completion(
                content=choice.message.content or "",
                truncated=getattr(choice, "finish_reason", None) == "length",
            )
        except AppError:
            raise
        except Exception as exc:  # provider error, timeout, malformed response object
            status = getattr(exc, "status_code", None)
            if status == 401:
                logger.error("Groq rejected the credentials - check GROQ_API_KEY")
            else:
                logger.error("Groq call failed: %s (status=%s)", type(exc).__name__, status)
            raise AppError(502, "upstream_error", "Language-model provider request failed") from exc


class LLMIntentRanker:
    def __init__(self, llm: ChatLLM) -> None:
        self._llm = llm

    async def rank(self, packet: EvidencePacket) -> FusionResult:
        # Code-level forced clarification: nothing usable to interpret, so no LLM call.
        if not packet.transcript.strip() and packet.visual_cues.gesture is None:
            return clarification_result("No transcript and no stable gesture to interpret.")
        messages = build_messages(packet)
        for attempt in (1, 2):  # one retry on invalid output
            completion = await self._llm.complete(messages)
            result = self._parse(completion)
            if result is not None:
                return result
            logger.warning("fusion output invalid (attempt %d)", attempt)
        return clarification_result("The model output could not be validated.")

    @staticmethod
    def _parse(completion: Completion) -> Optional[FusionResult]:
        if completion.truncated:  # truncated JSON counts as malformed
            return None
        try:
            return FusionResult.model_validate_json(completion.content)
        except ValidationError:
            return None


def get_ranker(request: HTTPConnection) -> IntentRanker:
    return LLMIntentRanker(GroqChatLLM(request.app.state.settings))
