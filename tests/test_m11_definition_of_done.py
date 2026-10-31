"""M11: the blueprint's five 'Definition of done' items, end-to-end with faked externals, plus hardening checks."""
import json
import logging

import httpx
import pytest

from logging_setup import RequestIdFilter
from tests.test_m9_pipeline import (  # shared fakes: scribe, vision backend, LLM, TTS, all on one fake clock
    FUSION_MS,
    TTS_MS,
    Rig,
    frames,
    setup_session,
    transcribe,
)


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


@pytest.fixture
def aclient(rig):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://test")


async def finish(c, sid, **body):
    r = await c.post(f"/sessions/{sid}/turn/finish", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def speak(c, sid, cid):
    return await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})


# ---------------------------------------------------------------- DoD 1
async def test_dod1_both_speakers_captured_labelled_with_context_visible(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "partner", "Water or tea?")
        await transcribe(c, rig, sid, "patient", "wa... water")
        turns = (await c.get(f"/sessions/{sid}/history")).json()["turns"]
        assert [(t["speaker"], t["text"]) for t in turns] == [("partner", "Water or tea?"), ("patient", "wa... water")]
        assert all(t["source"] == "scribe_batch" and isinstance(t["timestamp_ms"], int) for t in turns)
        ev = (await c.post(f"/sessions/{sid}/evidence", json={})).json()
        assert ev["transcript"] == "wa... water"  # the patient transcript is visible...
        assert ev["conversation_context"] == [{"speaker": "partner", "text": "Water or tea?"}]  # ...with recent context
        assert ev["speaker"] == "patient"


# ---------------------------------------------------------------- DoD 2
async def test_dod2_vision_returns_stable_gesture_and_face_features_with_timestamps(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await frames(c, rig, sid, n=5)
        cue = (await c.get(f"/sessions/{sid}/vision/cues")).json()["cue"]
        assert isinstance(cue["timestamp_ms"], int)
        assert set(cue["face"]) == {"detected", "mouth_activity", "mouth_score", "head_nod"}
        assert cue["gesture"]["label"] == "Thumb_Up" and cue["gesture"]["stable"] is True
        assert cue["gesture"]["meaning"] == "yes" and cue["gesture"]["score"] >= 0.6
        # a single frame is never "stable": a fresh session with one frame
        sid2 = await setup_session(c)
        await frames(c, rig, sid2, n=1)
        assert (await c.get(f"/sessions/{sid2}/vision/cues")).json()["cue"]["gesture"]["stable"] is False


# ---------------------------------------------------------------- DoD 3
async def test_dod3_valid_ranked_candidates_or_explicit_clarification(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "partner", "Water or tea?")
        await transcribe(c, rig, sid, "patient", "wa... water")
        ok = await finish(c, sid)
        f = ok["proposal"]["fusion"]
        assert f["clarification_required"] is False and 2 <= len(f["candidate_replies"]) <= 3
        assert all(r.strip() and len(r) <= 200 for r in f["candidate_replies"]) and f["intent"] == "request_water"
        assert ok["clarification_message"] is None
        # malformed model output twice -> an explicit clarification request, never a guessed reply
        rig.llm.override = {"intent": "request_water"}  # missing required fields
        bad = await finish(c, sid)
        assert bad["proposal"]["fusion"]["clarification_required"] is True and bad["proposal"]["fusion"]["candidate_replies"] == []
        assert bad["clarification_message"] == "I did not understand - please choose, repeat or clarify."


# ---------------------------------------------------------------- DoD 4
async def test_dod4_confirm_edit_reject_and_no_unconfirmed_reply_is_ever_spoken(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "partner", "Water or tea?")
        await transcribe(c, rig, sid, "patient", "wa... water")
        pending = (await finish(c, sid))["proposal"]
        rejected = (await finish(c, sid))["proposal"]
        clarified = (await finish(c, sid))["proposal"]
        assert (await c.post(f"/sessions/{sid}/proposals/{rejected['proposal_id']}/reject")).status_code == 200
        assert (await c.post(f"/sessions/{sid}/proposals/{clarified['proposal_id']}/clarify")).status_code == 200
        # every bypass attempt: random ids, rejected / clarified / pending proposal ids, made-up text
        for guess in ("0" * 32, "deadbeef", rejected["proposal_id"], clarified["proposal_id"], pending["proposal_id"], pending["turn_id"]):
            assert (await speak(c, sid, guess)).status_code in (404, 409), guess
        assert (await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": "x", "text": "say this"})).status_code == 422
        assert (await c.post(f"/sessions/{sid}/speak", json={})).status_code == 422
        for p in (rejected, clarified):  # terminal proposals cannot be turned into speech afterwards
            assert (await c.post(f"/sessions/{sid}/proposals/{p['proposal_id']}/confirm", json={"candidate_index": 0})).status_code == 409
            assert (await c.post(f"/sessions/{sid}/proposals/{p['proposal_id']}/edit", json={"text": "x"})).status_code == 409
        assert rig.synth.stream_calls == []  # nothing was ever synthesized
        # the patient CAN confirm...
        cid = (await c.post(f"/sessions/{sid}/proposals/{pending['proposal_id']}/confirm", json={"candidate_index": 1})).json()["confirmed"]["confirmed_id"]
        assert (await speak(c, sid, cid)).status_code == 200
        # ...or edit
        p2 = (await finish(c, sid))["proposal"]
        cid2 = (await c.post(f"/sessions/{sid}/proposals/{p2['proposal_id']}/edit", json={"text": "Tea, please."})).json()["confirmed"]["confirmed_id"]
        assert (await speak(c, sid, cid2)).status_code == 200
        assert [t for t, _ in rig.synth.stream_calls] == ["Could I have some water?", "Tea, please."]


# ---------------------------------------------------------------- DoD 5
async def test_dod5_tts_speaks_confirmed_sentence_and_turn_log_has_the_required_fields(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c, language="en")
        await transcribe(c, rig, sid, "partner", "Water or tea?")
        await frames(c, rig, sid)
        await transcribe(c, rig, sid, "patient", "wa... water")
        prop = (await finish(c, sid))["proposal"]
        r = await c.post(f"/sessions/{sid}/proposals/{prop['proposal_id']}/confirm", json={"candidate_index": 0})
        cid = r.json()["confirmed"]["confirmed_id"]
        sp = await speak(c, sid, cid)
        assert sp.status_code == 200 and sp.headers["content-type"] == "audio/mpeg"
        assert rig.synth.stream_calls[0][0] == "I would like water, please."  # the confirmed sentence, exactly
        assert sp.content.endswith(b"I would like water, please.")
        lines = rig.logfile.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        rec = json.loads(lines[0])
        assert rec["language"] == "en"
        assert "reference_transcript" in rec and rec["reference_transcript"] is None  # filled only by evaluation runs
        assert rec["transcript_raw"] == "wa... water" and rec["intent"] == "request_water"
        assert rec["system_latency_ms"] == FUSION_MS + TTS_MS and rec["wall_clock_ms"] >= rec["system_latency_ms"]


# ---------------------------------------------------------------- hardening
async def test_cors_default_none_and_configurable(tmp_path):
    async def probe(rig, origin):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://t") as c:
            return await c.get("/health", headers={"Origin": origin})

    assert "access-control-allow-origin" not in (await probe(Rig(tmp_path), "http://evil.example")).headers
    rig = Rig(tmp_path, CORS_ORIGINS="http://localhost:3000, https://demo.example")
    assert rig.app.state.settings.cors_origins == ["http://localhost:3000", "https://demo.example"]
    assert (await probe(rig, "http://localhost:3000")).headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in (await probe(rig, "http://evil.example")).headers
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://t") as c:
        pre = await c.options("/sessions", headers={"Origin": "https://demo.example", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == "https://demo.example"
    assert pre.headers["x-request-id"]


async def test_request_size_limits_hold_on_every_upload_path(tmp_path):
    rig = Rig(tmp_path, MAX_FRAME_BYTES="64", MAX_AUDIO_BYTES="64")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://t") as c:
        sid = await setup_session(c, consent=("audio_recording", "face_capture", "voice_cloning"))
        big = b"\x00" * 65
        r = await c.post(f"/sessions/{sid}/vision/frame", content=big)
        assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
        r = await c.post(f"/sessions/{sid}/transcribe", files={"audio": ("a.wav", big, "audio/wav")}, data={"speaker": "patient"})
        assert r.status_code == 413
        r = await c.post("/voices/clone", data={"name": "n", "session_id": sid}, files={"sample": ("s.wav", big, "audio/wav")})
        assert r.status_code == 413
        r = await c.post(f"/sessions/{sid}/turns/text", json={"speaker": "patient", "text": "x" * 1001})
        assert r.status_code == 422
        # nothing from the rejected requests was stored
        assert (await c.get(f"/sessions/{sid}/history")).json()["turns"] == []
        assert rig.synth.stream_calls == [] and len(rig.backend.script) == 0


def test_request_id_appears_in_server_logs(rig):
    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(record)

    h = Capture()
    h.addFilter(RequestIdFilter())  # the same filter the console handler uses
    log = logging.getLogger("ps16")
    log.addHandler(h)
    try:
        from fastapi.testclient import TestClient

        with TestClient(rig.app) as client:
            r = client.get("/health", headers={"X-Request-ID": "trace-me-123"})
            r2 = client.get("/health")
    finally:
        log.removeHandler(h)
    assert r.headers["x-request-id"] == "trace-me-123"
    http_logs = [x for x in records if x.name == "ps16.http"]
    assert [x.request_id for x in http_logs] == ["trace-me-123", r2.headers["x-request-id"]]
    assert all(x.request_id != "-" for x in http_logs)
