import asyncio
import base64
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from clock import FakeClock
from config import load_settings
from errors import AppError
from main import create_app
from services.scribe import (
    BatchResult,
    ElevenLabsTranscriber,
    RealtimeEvent,
    get_transcriber,
    scribe_language_code,
)

DEVANAGARI = "मुझे... पानी चाहिए, please?!  "  # punctuation, ellipsis, Devanagari, trailing spaces
DATA_DIR = Path(__file__).resolve().parent / "data"


class FakeRealtime:
    def __init__(self, handler, final_text):
        self.handler = handler
        self.final_text = final_text
        self.audio: list[bytes] = []
        self.commits = 0
        self.closed = False

    async def send_audio(self, pcm):
        self.audio.append(pcm)
        self.handler(RealtimeEvent("partial", f"partial{len(self.audio)}"))

    async def commit(self):
        self.commits += 1
        self.handler(RealtimeEvent("committed", self.final_text))

    async def close(self):
        self.closed = True


class FakeTranscriber:
    def __init__(self):
        self.text = "hello"
        self.fail: AppError | None = None
        self.calls: list[dict] = []
        self.rt_calls: list[dict] = []
        self.rt: FakeRealtime | None = None
        self.rt_final = "wa... water"

    async def transcribe(self, audio, filename, content_type, language_code):
        self.calls.append(dict(audio=audio, filename=filename, content_type=content_type, language_code=language_code))
        if self.fail:
            raise self.fail
        return BatchResult(self.text, "eng", 0.98, 1.5)

    async def open_realtime(self, language_code, handler):
        self.rt_calls.append({"language_code": language_code})
        if self.fail:
            raise self.fail
        self.rt = FakeRealtime(handler, self.rt_final)
        return self.rt


@pytest.fixture
def fake():
    return FakeTranscriber()


@pytest.fixture
def fclock():
    return FakeClock(0)


@pytest.fixture
def app(settings, fclock, fake):
    app = create_app(settings, clock=fclock)
    app.dependency_overrides[get_transcriber] = lambda: fake
    return app


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/consent", json={"audio_recording": True})
    return s


def up(client, sid, speaker="patient", audio=b"RIFFfakewav", **form):
    return client.post(
        f"/sessions/{sid}/transcribe",
        files={"audio": ("clip.wav", audio, "audio/wav")},
        data={"speaker": speaker, **form},
    )


def history(client, sid):
    return client.get(f"/sessions/{sid}/history").json()["turns"]


# ------------------------------------------------------------------ batch
def test_m3_t01_two_labelled_turns_in_order(client, sid, fake, fclock):
    fake.text = "Water or tea?"
    r1 = up(client, sid, "partner")
    fclock.advance(500)
    fake.text = "wa... water"
    r2 = up(client, sid, "patient")
    assert r1.status_code == r2.status_code == 200
    h = history(client, sid)
    assert [(t["speaker"], t["text"], t["source"]) for t in h] == [
        ("partner", "Water or tea?", "scribe_batch"),
        ("patient", "wa... water", "scribe_batch"),
    ]
    assert h[0]["timestamp_ms"] <= h[1]["timestamp_ms"]
    b = r2.json()
    assert b["turn"]["turn_id"] == h[1]["turn_id"] and b["raw_text"] == "wa... water"
    assert (b["language_code"], b["language_probability"], b["duration_s"]) == ("eng", 0.98, 1.5)


def test_m3_t02_invalid_speaker_and_missing_file(client, sid, fake):
    r = up(client, sid, "nurse")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.post(f"/sessions/{sid}/transcribe", data={"speaker": "patient"})
    assert r.status_code == 422
    r = client.post(f"/sessions/{sid}/transcribe", files={"audio": ("a.wav", b"x", "audio/wav")})
    assert r.status_code == 422  # speaker missing: never guessed (no diarization)
    assert up(client, sid, language="fr").status_code == 422
    assert fake.calls == [] and history(client, sid) == []


def test_m3_t03_empty_and_oversized(client, sid, fake, settings):
    r = up(client, sid, audio=b"")
    assert r.status_code == 422
    r = up(client, sid, audio=b"\x00" * (settings.max_audio_bytes + 1))
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
    assert fake.calls == [] and history(client, sid) == []


def test_m3_t04_no_consent_403_nothing_stored(client, fake):
    s = client.post("/sessions").json()["session_id"]
    r = up(client, s)
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_required"
    assert "audio_recording" in r.json()["error"]["message"]
    client.post(f"/sessions/{s}/consent", json={"face_capture": True})  # wrong purpose
    assert up(client, s).status_code == 403
    assert fake.calls == [] and history(client, s) == []


def test_m3_t05_raw_text_byte_for_byte(client, sid, fake):
    fake.text = DEVANAGARI
    r = up(client, sid)
    assert r.json()["raw_text"] == DEVANAGARI
    stored = history(client, sid)[0]["text"]
    assert stored == DEVANAGARI and stored.encode("utf-8") == DEVANAGARI.encode("utf-8")


def test_m3_silence_stores_nothing(client, sid, fake):
    fake.text = "  \n"
    r = up(client, sid)
    assert r.status_code == 200 and r.json()["turn"] is None and r.json()["raw_text"] == "  \n"
    assert history(client, sid) == []


@pytest.mark.parametrize(
    "session_lang,form_lang,expected",
    [("en", None, "eng"), ("hi", None, "hin"), ("mixed", None, None), ("en", "mixed", None), ("mixed", "hi", "hin")],
)
def test_m3_t06_language_mapping(client, fake, session_lang, form_lang, expected):
    s = client.post("/sessions", json={"language": session_lang}).json()["session_id"]
    client.post(f"/sessions/{s}/consent", json={"audio_recording": True})
    extra = {"language": form_lang} if form_lang else {}
    assert up(client, s, **extra).status_code == 200
    assert fake.calls[-1]["language_code"] is expected or fake.calls[-1]["language_code"] == expected
    assert fake.calls[-1]["audio"] == b"RIFFfakewav" and fake.calls[-1]["filename"] == "clip.wav"
    turn_lang = form_lang or session_lang
    assert history(client, s)[-1]["language"] == turn_lang


def test_m3_language_code_helper():
    assert (scribe_language_code("en"), scribe_language_code("hi"), scribe_language_code("mixed")) == ("eng", "hin", None)


def test_m3_t07_provider_failure_502(client, sid, fake):
    fake.fail = AppError(502, "upstream_error", "Speech-to-text provider request failed")
    r = up(client, sid)
    assert r.status_code == 502
    e = r.json()["error"]
    assert e["code"] == "upstream_error" and e["request_id"]
    assert history(client, sid) == []


def test_m3_t08_missing_key_503():
    app = create_app(load_settings({}, use_dotenv=False))  # no override, no key
    with TestClient(app) as c:
        s = c.post("/sessions").json()["session_id"]
        c.post(f"/sessions/{s}/consent", json={"audio_recording": True})
        r = up(c, s)
        assert r.status_code == 503 and r.json()["error"]["code"] == "not_configured"
        assert c.get(f"/sessions/{s}/history").json()["turns"] == []
        with c.websocket_connect(f"/ws/sessions/{s}/scribe") as ws:
            ws.send_json({"type": "start", "speaker": "patient"})
            assert ws.receive_json()["code"] == "not_configured"


def test_m3_t12_stage_ms(client, sid, fake):
    r = up(client, sid)
    assert isinstance(r.json()["stage_ms"], int) and r.json()["stage_ms"] >= 0


# ------------------------------------------------------------------ adapter (fake SDK client)
class FakeStt:
    def __init__(self, resp=None, exc=None):
        self.resp, self.exc, self.kwargs = resp, exc, None

    async def convert(self, **kwargs):
        self.kwargs = kwargs
        if self.exc:
            raise self.exc
        return self.resp


def sdk_settings(**env):
    return load_settings({"ELEVENLABS_API_KEY": "sk-test", **env}, use_dotenv=False)


async def test_m3_t06_adapter_omits_language_code_for_mixed():
    resp = SimpleNamespace(text="hi", language_code="hin", language_probability=0.9, audio_duration_secs=2.0)
    stt = FakeStt(resp)
    t = ElevenLabsTranscriber(sdk_settings(), client=SimpleNamespace(speech_to_text=stt))
    out = await t.transcribe(b"abc", "a.wav", "audio/wav", None)
    assert "language_code" not in stt.kwargs
    assert stt.kwargs["model_id"] == "scribe_v2" and stt.kwargs["file"] == ("a.wav", b"abc", "audio/wav")
    assert out == BatchResult("hi", "hin", 0.9, 2.0)
    await t.transcribe(b"abc", "a.wav", "audio/wav", "hin")
    assert stt.kwargs["language_code"] == "hin"


async def test_m3_adapter_error_mapping(caplog):
    class Boom(Exception):
        status_code = 401

    t = ElevenLabsTranscriber(sdk_settings(), client=SimpleNamespace(speech_to_text=FakeStt(exc=Boom("sk-test leaked?"))))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(AppError) as ei:
            await t.transcribe(b"a", "a", None, None)
    assert ei.value.status == 502 and "sk-test" not in ei.value.message
    assert "sk-test" not in caplog.text and "check ELEVENLABS_API_KEY" in caplog.text  # 401 hint, no secret
    t = ElevenLabsTranscriber(sdk_settings(), client=SimpleNamespace(speech_to_text=FakeStt(resp=SimpleNamespace())))
    with pytest.raises(AppError) as ei:
        await t.transcribe(b"a", "a", None, None)
    assert ei.value.status == 502
    no_key = ElevenLabsTranscriber(load_settings({}, use_dotenv=False))
    with pytest.raises(AppError) as ei:
        await no_key.transcribe(b"a", "a", None, None)
    assert ei.value.status == 503


class FakeConn:
    def __init__(self):
        self.handlers, self.sent, self.committed, self.closed = {}, [], 0, False

    def on(self, event, cb):
        self.handlers[event] = cb

    async def send(self, data):
        self.sent.append(data)

    async def commit(self):
        self.committed += 1

    async def close(self):
        self.closed = True


class FakeRt:
    def __init__(self):
        self.conn, self.options = FakeConn(), None

    async def connect(self, options):
        self.options = options
        return self.conn


async def test_m3_realtime_adapter():
    from elevenlabs import AudioFormat, CommitStrategy, RealtimeEvents

    rt = FakeRt()
    t = ElevenLabsTranscriber(sdk_settings(), client=SimpleNamespace(speech_to_text=SimpleNamespace(realtime=rt)))
    events = []
    session = await t.open_realtime(None, events.append)
    o = rt.options
    assert o["model_id"] == "scribe_v2_realtime" and o["audio_format"] == AudioFormat.PCM_16000
    assert o["sample_rate"] == 16000 and o["commit_strategy"] == CommitStrategy.MANUAL
    assert "language_code" not in o
    h = rt.conn.handlers
    h[RealtimeEvents.PARTIAL_TRANSCRIPT]({"message_type": "partial_transcript", "text": "wa"})
    h[RealtimeEvents.COMMITTED_TRANSCRIPT]({"message_type": "committed_transcript", "text": "water"})
    h[RealtimeEvents.COMMITTED_TRANSCRIPT]({"transcript": "alt key"})
    h[RealtimeEvents.ERROR]({"message_type": "rate_limited"})
    assert events == [
        RealtimeEvent("partial", "wa"),
        RealtimeEvent("committed", "water"),
        RealtimeEvent("committed", "alt key"),
        RealtimeEvent("error", code="rate_limited"),
    ]
    await session.send_audio(b"\x01\x02")
    assert rt.conn.sent == [{"audio_base_64": base64.b64encode(b"\x01\x02").decode()}]
    await session.commit()
    await session.close()
    assert rt.conn.committed == 1 and rt.conn.closed
    await (ElevenLabsTranscriber(sdk_settings(), client=SimpleNamespace(speech_to_text=SimpleNamespace(realtime=rt)))
           .open_realtime("hin", events.append))
    assert rt.options["language_code"] == "hin"


# ------------------------------------------------------------------ realtime WS
def test_m3_t09_ws_partials_then_committed_only_committed_stored(client, sid, fake):
    with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
        ws.send_json({"type": "start", "speaker": "patient", "language": "en"})
        assert ws.receive_json() == {"type": "started", "speaker": "patient", "language": "en"}
        ws.send_bytes(b"\x00\x01" * 100)
        p1 = ws.receive_json()
        ws.send_bytes(b"\x00\x01" * 100)
        p2 = ws.receive_json()
        assert (p1["type"], p1["text"], p1["speaker"]) == ("partial", "partial1", "patient")
        assert p2["type"] == "partial" and isinstance(p2["timestamp_ms"], int)
        assert history(client, sid) == []  # partials are never stored
        ws.send_json({"type": "commit"})
        c = ws.receive_json()
        assert (c["type"], c["text"], c["speaker"]) == ("committed", "wa... water", "patient")
        ws.send_json({"type": "stop"})
    h = history(client, sid)
    assert [(t["speaker"], t["text"], t["source"]) for t in h] == [("patient", "wa... water", "scribe_realtime")]
    assert c["turn_id"] == h[0]["turn_id"]
    assert fake.rt.closed and len(fake.rt.audio) == 2 and fake.rt_calls == [{"language_code": "eng"}]


def test_m3_t10_ws_no_consent_and_bad_start(client, sid, fake):
    s = client.post("/sessions").json()["session_id"]
    with client.websocket_connect(f"/ws/sessions/{s}/scribe") as ws:
        e = ws.receive_json()
        assert e["type"] == "error" and e["code"] == "consent_required"
    with client.websocket_connect("/ws/sessions/nope/scribe") as ws:
        assert ws.receive_json()["code"] == "not_found"
    for bad in (
        {"type": "start", "speaker": "nurse"},
        {"type": "start"},
        {"type": "start", "speaker": "patient", "language": "fr"},
        {"type": "commit"},
        {"speaker": "patient"},
    ):
        with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
            ws.send_json(bad)
            e = ws.receive_json()
            assert e["type"] == "error" and e["code"] == "validation_error", bad
    with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "validation_error"
    assert fake.rt is None and history(client, sid) == []


def test_m3_t11_ws_manual_commit_and_control_errors(client, sid, fake):
    fake.rt_final = "मुझे पानी चाहिए"
    with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
        ws.send_json({"type": "start", "speaker": "partner", "language": "mixed"})
        ws.receive_json()
        ws.send_json({"type": "commit"})  # commit with no audio still triggers the committed event
        c = ws.receive_json()
        assert c["type"] == "committed" and c["text"] == "मुझे पानी चाहिए" and c["speaker"] == "partner"
        ws.send_json({"type": "bogus"})
        assert ws.receive_json()["code"] == "validation_error"
        ws.send_json({"type": "stop"})
    assert fake.rt.commits == 1 and fake.rt_calls == [{"language_code": None}]
    assert history(client, sid)[0]["speaker"] == "partner"


def test_m3_ws_empty_committed_not_stored_and_consent_withdrawn(client, sid, fake):
    fake.rt_final = "   "
    with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
        ws.send_json({"type": "start", "speaker": "patient"})
        ws.receive_json()
        ws.send_json({"type": "commit"})
        assert ws.receive_json()["type"] == "committed"
        client.post(f"/sessions/{sid}/consent", json={})  # withdrawn mid-stream
        ws.send_bytes(b"\x00\x00")
        assert ws.receive_json()["code"] == "consent_required"
    assert history(client, sid) == [] and fake.rt.audio == [] and fake.rt.closed


def test_m3_ws_size_cap(client, sid, fake, settings):
    with client.websocket_connect(f"/ws/sessions/{sid}/scribe") as ws:
        ws.send_json({"type": "start", "speaker": "patient"})
        ws.receive_json()
        ws.send_bytes(b"\x00" * (settings.max_audio_bytes + 1))
        assert ws.receive_json()["code"] == "too_large"
    assert fake.rt.audio == []


# ------------------------------------------------------------------ live
_clips = sorted(p for ext in ("wav", "mp3", "m4a", "flac", "ogg") for p in DATA_DIR.glob(f"*.{ext}"))
_live_settings = load_settings()  # reads the real .env (live tests only)


@pytest.mark.live
@pytest.mark.skipif(not _live_settings.elevenlabs_api_key, reason="ELEVENLABS_API_KEY not set; live Scribe test skipped")
@pytest.mark.skipif(not _clips, reason="no audio clip in tests/data/ (add a short wav/mp3); live Scribe test skipped")
async def test_m3_live_scribe_batch():
    clip = _clips[0]
    t = ElevenLabsTranscriber(_live_settings)
    out = await t.transcribe(clip.read_bytes(), clip.name, None, None)
    assert out.text.strip()
