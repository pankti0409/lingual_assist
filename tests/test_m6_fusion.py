import asyncio
import json
import logging
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from clock import FakeClock
from config import load_settings
from errors import AppError
from main import create_app
from schemas import FusionResult
from services.fusion import (
    CLARIFICATION_MESSAGE,
    Completion,
    GroqChatLLM,
    LLMIntentRanker,
    build_messages,
    get_ranker,
    system_prompt,
    wire_schema,
)
from services.vision import FaceObs, FrameObs, GestureObs

WATER = {
    "intent": "request_water",
    "candidate_replies": ["I would like water, please.", "Could I have some water?"],
    "clarification_required": False,
    "reasoning_summary": "Transcript and recent question align.",
}


def ok(**over):
    return Completion(json.dumps({**WATER, **over}))


class FakeLLM:
    def __init__(self, *script):
        self.script = list(script)
        self.calls: list[list[dict]] = []

    async def complete(self, messages):
        self.calls.append(messages)
        item = self.script.pop(0) if self.script else ok()
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def fclock():
    return FakeClock(0)


@pytest.fixture
def app(settings, fclock, llm):
    app = create_app(settings, clock=fclock)
    app.dependency_overrides[get_ranker] = lambda: LLMIntentRanker(llm)
    return app


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/consent", json={"face_capture": True})
    return s


def say(client, sid, speaker, text, **kw):
    r = client.post(f"/sessions/{sid}/turns/text", json={"speaker": speaker, "text": text, **kw})
    assert r.status_code == 201
    return r.json()


def water(client, sid):
    say(client, sid, "partner", "Water or tea?")
    return say(client, sid, "patient", "wa... water")


def fuse(client, sid, **body):
    return client.post(f"/sessions/{sid}/fuse", json=body)


# ------------------------------------------------------------------ happy path / retries
def test_m6_t01_valid_output_stored_pending(client, app, sid, llm):
    water(client, sid)
    r = fuse(client, sid)
    assert r.status_code == 200
    b = r.json()
    p = b["proposal"]
    assert p["state"] == "pending" and p["session_id"] == sid and len(p["proposal_id"]) == 32
    assert p["fusion"] == WATER and p["evidence_timestamp_ms"] == b["evidence"]["timestamp_ms"]
    assert b["clarification_message"] is None and b["stage_ms"] >= 0
    assert app.state.proposals.get(sid, p["proposal_id"]).fusion.intent == "request_water"
    assert len(llm.calls) == 1


def test_m6_t02_malformed_then_valid_one_retry(client, sid, llm):
    llm.script = [Completion("not json {"), ok()]
    water(client, sid)
    r = fuse(client, sid)
    assert r.status_code == 200 and r.json()["proposal"]["fusion"] == WATER
    assert len(llm.calls) == 2


def test_m6_t03_malformed_twice_clarifies_without_guessing(client, sid, llm):
    llm.script = [Completion("garbage"), Completion('{"intent": "request_water"}'), ok()]
    water(client, sid)
    r = fuse(client, sid)
    assert r.status_code == 200
    f = r.json()["proposal"]["fusion"]
    assert f["clarification_required"] is True and f["candidate_replies"] == []
    assert r.json()["clarification_message"] == CLARIFICATION_MESSAGE
    assert len(llm.calls) == 2  # exactly one retry, never a third call


def test_m6_truncated_output_is_malformed(client, sid, llm):
    valid_but_truncated = Completion(json.dumps(WATER), truncated=True)
    llm.script = [valid_but_truncated, valid_but_truncated]
    water(client, sid)
    f = fuse(client, sid).json()["proposal"]["fusion"]
    assert f["clarification_required"] is True and f["candidate_replies"] == []
    assert len(llm.calls) == 2


# ------------------------------------------------------------------ schema validation
@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: {**d, "extra": 1},
        lambda d: {k: v for k, v in d.items() if k != "reasoning_summary"},
        lambda d: {k: v for k, v in d.items() if k != "candidate_replies"},
        lambda d: {**d, "candidate_replies": ["only one"]},
        lambda d: {**d, "candidate_replies": ["a", "b", "c", "d"]},
        lambda d: {**d, "candidate_replies": ["a", "x" * 201]},
        lambda d: {**d, "candidate_replies": ["a", "   "]},
        lambda d: {**d, "candidate_replies": []},
        lambda d: {**d, "intent": "Request Water"},
        lambda d: {**d, "intent": "x" * 61},
        lambda d: {**d, "reasoning_summary": "x" * 301},
        lambda d: {**d, "clarification_required": "no"},
    ],
)
def test_m6_t04_invalid_schema_rejected(mutate):
    with pytest.raises(ValidationError):
        FusionResult.model_validate(mutate(WATER))


def test_m6_t04b_boundaries_accepted():
    assert FusionResult.model_validate({**WATER, "candidate_replies": ["a", "b", "c"]})
    assert FusionResult.model_validate({**WATER, "intent": "x" * 60, "reasoning_summary": "y" * 300})
    assert FusionResult.model_validate({**WATER, "candidate_replies": ["a", "x" * 200]})


def test_m6_t04c_invalid_schema_over_http_retries_then_clarifies(client, sid, llm):
    bad = Completion(json.dumps({**WATER, "candidate_replies": ["only one"]}))
    llm.script = [bad, bad]
    water(client, sid)
    assert fuse(client, sid).json()["proposal"]["fusion"]["clarification_required"] is True


def test_m6_t05_clarification_passthrough(client, sid, llm):
    for replies in ([], ["Water?"], ["Water?", "Tea?", "Nothing"]):
        llm.script = [ok(clarification_required=True, candidate_replies=replies, intent="unclear")]
        water(client, sid)
        r = fuse(client, sid).json()
        assert r["proposal"]["fusion"]["candidate_replies"] == replies
        assert r["proposal"]["fusion"]["clarification_required"] is True
        assert r["clarification_message"] == "I did not understand - please choose, repeat or clarify."
        assert r["proposal"]["state"] == "pending"  # nothing auto-selected


def test_m6_t06_empty_transcript_no_gesture_no_llm_call(client, app, sid, llm):
    say(client, sid, "partner", "Water or tea?")
    # typed turns cannot be blank, so build the blank patient turn directly in session state
    app.state.sessions.get(sid).conversation.add_turn("patient", "   ", "en", "scribe_batch")
    r = fuse(client, sid)
    assert r.status_code == 200
    f = r.json()["proposal"]["fusion"]
    assert f["clarification_required"] is True and f["candidate_replies"] == []
    assert r.json()["clarification_message"] == CLARIFICATION_MESSAGE
    assert llm.calls == []


def test_m6_blank_transcript_with_stable_gesture_still_calls_llm(client, app, sid, llm, fclock):
    tr = app.state.vision.for_session(sid).tracker
    for i in range(4):
        tr.observe(FrameObs(i * 100, FaceObs({}, 0.0), GestureObs("Thumb_Up", 0.9, "Right")))
    fclock.advance(400)
    app.state.sessions.get(sid).conversation.add_turn("patient", "", "en", "scribe_batch")
    assert fuse(client, sid).status_code == 200
    assert len(llm.calls) == 1


def test_m6_llm_clarification_never_overridden(client, sid, llm):
    llm.script = [ok(clarification_required=True, candidate_replies=["a", "b"])]
    water(client, sid)
    assert fuse(client, sid).json()["proposal"]["fusion"]["clarification_required"] is True


# ------------------------------------------------------------------ prompt / request content
def test_m6_t07_prompt_rules(client, sid, llm):
    water(client, sid)
    fuse(client, sid)
    system = llm.calls[0][0]
    assert system["role"] == "system"
    s = system["content"]
    for phrase in (
        "Use ONLY the supplied evidence",
        "Do not invent facts",
        "Do NOT diagnose any condition",
        "Do NOT infer emotion or mood from visual cues",
        "only what `gesture.meaning` states",
        "set `clarification_required` to true",
        "Return JSON only",
        "no markdown",
    ):
        assert phrase in s, phrase
    assert "{language_style}" not in s


def test_m6_t08_water_scenario_proposal(client, app, sid, llm, fclock):
    tr = app.state.vision.for_session(sid).tracker
    for i in range(4):
        tr.observe(FrameObs(i * 100, FaceObs({}, 0.0), GestureObs("Thumb_Up", 0.91, "Right")))
    fclock.advance(400)
    water(client, sid)
    b = fuse(client, sid).json()
    assert b["evidence"]["visual_cues"]["gesture"] == {"label": "Thumb_Up", "score": 0.91, "meaning": "yes"}
    assert b["evidence"]["conversation_context"] == [{"speaker": "partner", "text": "Water or tea?"}]
    replies = b["proposal"]["fusion"]["candidate_replies"]
    assert b["proposal"]["fusion"]["intent"] == "request_water"
    assert all("water" in r.lower() for r in replies) and len(replies) == 2


def test_m6_t09_request_contains_only_the_packet(client, app, sid, llm, fclock):
    tr = app.state.vision.for_session(sid).tracker
    for i in range(4):
        tr.observe(FrameObs(i * 100, FaceObs({"jawOpen": 0.5}, 1.0), GestureObs("Thumb_Up", 0.91, "Right")))
    fclock.advance(400)
    water(client, sid)
    b = fuse(client, sid).json()
    msgs = llm.calls[0]
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert json.loads(msgs[1]["content"]) == b["evidence"]  # exactly the evidence packet
    blob = json.dumps(msgs).lower()
    for banned in ("base64", "audio", "frame", "image", "landmark", "blendshape", "jawopen", "handedness", "pitch"):
        assert banned not in blob.replace("audio_recording", ""), banned

    def no_bytes(o):
        if isinstance(o, dict):
            return all(no_bytes(v) for v in o.values())
        if isinstance(o, list):
            return all(no_bytes(v) for v in o)
        return not isinstance(o, (bytes, bytearray, np.ndarray))

    assert no_bytes(msgs) and all(isinstance(m["content"], str) for m in msgs)


def test_m6_t11_language_style_follows_language(client, llm):
    expect = {"en": "English", "hi": "Hindi (Devanagari script)", "mixed": "the same Hindi–English mix the patient used"}
    for lang, style in expect.items():
        s = client.post("/sessions", json={"language": lang}).json()["session_id"]
        say(client, s, "patient", "paani")
        fuse(client, s)
        assert f"in {style}. Return JSON only" in llm.calls[-1][0]["content"], lang
        assert system_prompt(lang).count(style) == 1


def test_m6_t12_conflicting_evidence_proposal_reflects_clarification(client, sid, llm):
    llm.script = [ok(clarification_required=True, candidate_replies=[], intent="unclear",
                     reasoning_summary="Gesture and transcript conflict.")]
    say(client, sid, "partner", "Do you want water?")
    say(client, sid, "patient", "no... w-")
    r = fuse(client, sid).json()
    assert r["proposal"]["fusion"]["clarification_required"] is True
    assert r["proposal"]["fusion"]["candidate_replies"] == []
    assert r["clarification_message"]


# ------------------------------------------------------------------ errors
def test_m6_t10_provider_error_502(client, sid, llm):
    llm.script = [AppError(502, "upstream_error", "Language-model provider request failed")]
    water(client, sid)
    r = fuse(client, sid)
    assert r.status_code == 502
    e = r.json()["error"]
    assert e["code"] == "upstream_error" and e["request_id"]


def test_m6_t10b_missing_key_503():
    app = create_app(load_settings({}, use_dotenv=False))
    with TestClient(app) as c:
        s = c.post("/sessions").json()["session_id"]
        say(c, s, "patient", "water")
        r = fuse(c, s)
        assert r.status_code == 503 and r.json()["error"]["code"] == "not_configured"
        assert app.state.proposals.list(s) == []


def test_m6_no_proposal_stored_on_failure(client, app, sid, llm):
    llm.script = [AppError(502, "upstream_error", "x")]
    water(client, sid)
    fuse(client, sid)
    assert app.state.proposals.list(sid) == []


def test_m6_turn_selection_errors(client, sid):
    assert fuse(client, sid).status_code == 409
    p = say(client, sid, "partner", "hi")
    assert fuse(client, sid, turn_id=p["turn_id"]).status_code == 422
    assert fuse(client, sid, turn_id="nope").status_code == 404
    assert client.post("/sessions/nope/fuse", json={}).status_code == 404


def test_m6_include_visual_cues_false_reaches_packet(client, app, sid, llm, fclock):
    tr = app.state.vision.for_session(sid).tracker
    for i in range(4):
        tr.observe(FrameObs(i * 100, FaceObs({}, 0.0), GestureObs("Thumb_Up", 0.91, "Right")))
    fclock.advance(400)
    water(client, sid)
    b = fuse(client, sid, include_visual_cues=False).json()
    assert b["evidence"]["visual_cues"]["gesture"] is None
    assert json.loads(llm.calls[0][1]["content"])["visual_cues"]["gesture"] is None


def test_m6_proposals_isolated_and_cleaned_on_delete(client, app, sid, llm):
    water(client, sid)
    pid = fuse(client, sid).json()["proposal"]["proposal_id"]
    other = client.post("/sessions").json()["session_id"]
    assert app.state.proposals.get(other, pid) is None  # foreign session cannot see it
    assert app.state.proposals.get(sid, pid) is not None
    client.delete(f"/sessions/{sid}")
    assert app.state.proposals.get(sid, pid) is None


# ------------------------------------------------------------------ adapter (fake SDK client)
def groq_settings(**env):
    return load_settings({"GROQ_API_KEY": "gsk-test", **env}, use_dotenv=False)


class FakeGroq:
    def __init__(self, content='{"a":1}', finish="stop", exc=None, hang=False):
        self.kwargs = None
        self.content, self.finish, self.exc, self.hang = content, finish, exc, hang
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.kwargs = kwargs
        if self.hang:
            await asyncio.Event().wait()
        if self.exc:
            raise self.exc
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content), finish_reason=self.finish)]
        )


async def test_m6_adapter_request_parameters():
    fake = FakeGroq()
    llm = GroqChatLLM(groq_settings(), client=fake)
    out = await llm.complete([{"role": "user", "content": "x"}])
    assert out == Completion('{"a":1}', False)
    k = fake.kwargs
    assert k["model"] == "openai/gpt-oss-120b" and k["reasoning_effort"] == "low"
    assert k["temperature"] == 0.2 and k["max_completion_tokens"] == 1024
    rf = k["response_format"]
    assert rf["type"] == "json_schema" and rf["json_schema"]["strict"] is True
    schema = rf["json_schema"]["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"]) == set(FusionResult.model_fields)
    assert wire_schema() == schema


async def test_m6_adapter_truncation_flag_and_empty_content():
    assert (await GroqChatLLM(groq_settings(), client=FakeGroq(finish="length")).complete([])).truncated is True
    assert (await GroqChatLLM(groq_settings(), client=FakeGroq(content=None)).complete([])).content == ""


async def test_m6_adapter_errors_map_to_502_without_leaking_key(caplog):
    class Boom(Exception):
        status_code = 401

    llm = GroqChatLLM(groq_settings(), client=FakeGroq(exc=Boom("gsk-test rejected")))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(AppError) as ei:
            await llm.complete([])
    assert ei.value.status == 502 and "gsk-test" not in ei.value.message
    assert "gsk-test" not in caplog.text and "check GROQ_API_KEY" in caplog.text
    with pytest.raises(AppError) as ei:
        await GroqChatLLM(groq_settings(), client=FakeGroq(exc=asyncio.TimeoutError())).complete([])
    assert ei.value.status == 502


async def test_m6_adapter_timeout_enforced():
    llm = GroqChatLLM(groq_settings(LLM_TIMEOUT_S="0.05"), client=FakeGroq(hang=True))
    with pytest.raises(AppError) as ei:
        await llm.complete([])
    assert ei.value.status == 502


async def test_m6_adapter_missing_key_503():
    with pytest.raises(AppError) as ei:
        await GroqChatLLM(load_settings({}, use_dotenv=False)).complete([])
    assert ei.value.status == 503


def test_m6_build_messages_shape():
    from services.evidence import EvidencePacket

    p = EvidencePacket(transcript="paani", language="hi", timestamp_ms=1, conversation_context=[],
                       visual_cues={"gesture": None, "mouth_activity": False, "head_nod": False})
    m = build_messages(p)
    assert "Hindi (Devanagari script)" in m[0]["content"] and "paani" in m[1]["content"]


# ------------------------------------------------------------------ live
_live = load_settings()


@pytest.mark.live
@pytest.mark.skipif(not _live.groq_api_key, reason="GROQ_API_KEY not set; live Groq test skipped")
async def test_m6_live_groq_water_scenario():
    from services.evidence import EvidencePacket

    packet = EvidencePacket(
        transcript="wa... water", language="en", timestamp_ms=12400,
        conversation_context=[{"speaker": "partner", "text": "Water or tea?"}],
        visual_cues={"gesture": {"label": "Thumb_Up", "score": 0.91, "meaning": "yes"}, "mouth_activity": True, "head_nod": False},
    )
    result = await LLMIntentRanker(GroqChatLLM(_live)).rank(packet)
    assert isinstance(result, FusionResult)
