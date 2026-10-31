import json
import logging
import os
import tempfile
from types import SimpleNamespace
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from clock import FakeClock
from config import load_settings
from errors import AppError
from main import create_app
from services.fusion import Completion, LLMIntentRanker, get_ranker
from services.tts import ElevenLabsSynthesizer, VoiceInfo, get_synthesizer

WATER = {
    "intent": "request_water",
    "candidate_replies": ["I would like water, please.", "Could I have some water?"],
    "clarification_required": False,
    "reasoning_summary": "Transcript and recent question align.",
}
SAMPLES = ["I would like water, please.", "मुझे पानी चाहिए, कृपया...", "Mujhe paani chahiye please, thanks!  é"]


class FakeLLM:
    async def complete(self, messages):
        return Completion(json.dumps(WATER))


class FakeSynth:
    def __init__(self, clock):
        self.clock = clock
        self.stream_calls: list[tuple[str, str]] = []
        self.clone_calls: list[tuple] = []
        self.design_calls: list[tuple] = []
        self.chunks = [b"ID3", b"audio", b"-bytes"]
        self.latency_ms = 0
        self.fail: Exception | None = None

    async def stream(self, text, voice_id):
        self.stream_calls.append((text, voice_id))
        self.clock.advance(self.latency_ms)
        if self.fail:
            raise self.fail
        for c in self.chunks:
            yield c

    async def list_voices(self):
        return [VoiceInfo("v1", "Rachel", "premade")]

    async def clone_voice(self, name, sample, filename, content_type):
        self.clone_calls.append((name, sample, filename, content_type))
        if self.fail:
            raise self.fail
        return "cloned-voice-1"

    async def design_voice(self, name, description):
        self.design_calls.append((name, description))
        if self.fail:
            raise self.fail
        return "designed-voice-1"


@pytest.fixture
def fclock():
    return FakeClock(0)


@pytest.fixture
def synth(fclock):
    return FakeSynth(fclock)


@pytest.fixture
def app(settings, fclock, synth):
    app = create_app(settings, clock=fclock)
    app.dependency_overrides[get_synthesizer] = lambda: synth
    app.dependency_overrides[get_ranker] = lambda: LLMIntentRanker(FakeLLM())
    return app


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/turns/text", json={"speaker": "partner", "text": "Water or tea?"})
    client.post(f"/sessions/{s}/turns/text", json={"speaker": "patient", "text": "wa... water"})
    return s


def design(client, sid):
    return client.post("/voices/design", json={"session_id": sid, "description": "A calm warm adult voice"})


def proposal(client, sid):
    return client.post(f"/sessions/{sid}/fuse", json={}).json()["proposal"]


def confirm(client, sid, idx=0):
    p = proposal(client, sid)
    return client.post(f"/sessions/{sid}/proposals/{p['proposal_id']}/confirm", json={"candidate_index": idx}).json()["confirmed"]


def speak(client, sid, cid):
    return client.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})


# ------------------------------------------------------------------ I1
def test_m8_t01_speak_requires_a_known_confirmed_id(client, sid, synth):
    design(client, sid)
    assert client.post(f"/sessions/{sid}/speak", json={}).status_code == 422
    assert client.post(f"/sessions/{sid}/speak").status_code == 422
    assert client.post(f"/sessions/{sid}/speak", json={"confirmed_id": 5}).status_code == 422
    # free text is never accepted
    r = client.post(f"/sessions/{sid}/speak", json={"confirmed_id": "x", "text": "say anything"})
    assert r.status_code == 422
    r = speak(client, sid, "deadbeef")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.post("/sessions/nope/speak", json={"confirmed_id": "x"}).status_code == 404
    assert synth.stream_calls == []


def test_m8_t02_unconfirmed_proposals_never_spoken(client, sid, synth):
    design(client, sid)
    pending = proposal(client, sid)
    rejected = proposal(client, sid)
    clarified = proposal(client, sid)
    confirmed_p = proposal(client, sid)
    client.post(f"/sessions/{sid}/proposals/{rejected['proposal_id']}/reject")
    client.post(f"/sessions/{sid}/proposals/{clarified['proposal_id']}/clarify")
    client.post(f"/sessions/{sid}/proposals/{confirmed_p['proposal_id']}/confirm", json={"candidate_index": 0})
    for p in (pending, rejected, clarified, confirmed_p):  # proposal ids are not confirmed ids
        r = speak(client, sid, p["proposal_id"])
        assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state", p["state"]
    assert synth.stream_calls == []


def test_m8_foreign_session_confirmed_id_404(client, sid, synth):
    design(client, sid)
    cid = confirm(client, sid)["confirmed_id"]
    other = client.post("/sessions").json()["session_id"]
    design(client, other)
    assert speak(client, other, cid).status_code == 404
    assert synth.stream_calls == []


@pytest.mark.parametrize("text", SAMPLES)
def test_m8_t03_synthesizer_receives_confirmed_text_byte_for_byte(client, sid, synth, text):
    design(client, sid)
    p = proposal(client, sid)
    c = client.post(f"/sessions/{sid}/proposals/{p['proposal_id']}/edit", json={"text": text}).json()["confirmed"]
    r = speak(client, sid, c["confirmed_id"])
    assert r.status_code == 200
    sent, voice = synth.stream_calls[-1]
    assert sent.encode("utf-8") == c["text"].encode("utf-8") == text.strip().encode("utf-8")
    assert unquote(r.headers["x-subtitle-text"]) == text.strip()  # subtitle matches, non-ASCII safe
    assert voice == "designed-voice-1"


def test_m8_candidate_text_exact_and_audio_streamed(client, sid, synth):
    design(client, sid)
    cid = confirm(client, sid, idx=1)["confirmed_id"]
    r = speak(client, sid, cid)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3audio-bytes"
    assert synth.stream_calls == [("Could I have some water?", "designed-voice-1")]
    assert r.headers["x-confirmed-id"] == cid and r.headers["x-tts-model"] == "eleven_flash_v2_5"


def test_m8_replay_allowed_and_logged(client, app, sid, synth, fclock):
    design(client, sid)
    cid = confirm(client, sid)["confirmed_id"]
    assert speak(client, sid, cid).status_code == 200
    fclock.advance(1000)
    assert speak(client, sid, cid).status_code == 200
    log = app.state.speaklog.list(sid)
    assert [r.confirmed_id for r in log] == [cid, cid] and log[1].spoken_at_ms >= log[0].spoken_at_ms + 1000


# ------------------------------------------------------------------ consent / voices
def test_m8_t04_clone_requires_voice_cloning_consent(client, sid, synth):
    r = client.post("/voices/clone", data={"name": "me", "session_id": sid}, files={"sample": ("s.wav", b"RIFFsample", "audio/wav")})
    assert r.status_code == 403 and r.json()["error"]["code"] == "consent_required"
    assert "voice_cloning" in r.json()["error"]["message"]
    client.post(f"/sessions/{sid}/consent", json={"audio_recording": True, "face_capture": True, "demo_use": True})
    r = client.post("/voices/clone", data={"name": "me", "session_id": sid}, files={"sample": ("s.wav", b"RIFFsample", "audio/wav")})
    assert r.status_code == 403  # other purposes do not cover cloning
    assert synth.clone_calls == []
    assert client.get(f"/sessions/{sid}").json()["voice_mode"] == "none"
    r = client.post("/voices/clone", data={"name": "me", "session_id": "nope"}, files={"sample": ("s.wav", b"x", "audio/wav")})
    assert r.status_code == 404


def test_m8_clone_with_consent_sets_session_voice(client, sid, synth):
    client.post(f"/sessions/{sid}/consent", json={"voice_cloning": True})
    r = client.post("/voices/clone", data={"name": " Me ", "session_id": sid}, files={"sample": ("s.wav", b"RIFFsample", "audio/wav")})
    assert r.status_code == 200
    b = r.json()
    assert (b["voice_id"], b["persona"], b["name"]) == ("cloned-voice-1", "cloned_voice", "Me")
    assert synth.clone_calls == [("Me", b"RIFFsample", "s.wav", "audio/wav")]
    assert client.get(f"/sessions/{sid}").json()["voice_mode"] == "clone"
    cid = confirm(client, sid)["confirmed_id"]
    r = speak(client, sid, cid)
    assert synth.stream_calls[-1][1] == "cloned-voice-1" and r.headers["x-voice-persona"] == "cloned_voice"


def test_m8_clone_input_validation(client, sid, synth, settings):
    client.post(f"/sessions/{sid}/consent", json={"voice_cloning": True})
    f = lambda data: {"sample": ("s.wav", data, "audio/wav")}  # noqa: E731
    assert client.post("/voices/clone", data={"name": "me", "session_id": sid}, files=f(b"")).status_code == 422
    assert client.post("/voices/clone", data={"name": "  ", "session_id": sid}, files=f(b"x")).status_code == 422
    r = client.post("/voices/clone", data={"name": "me", "session_id": sid}, files=f(b"\0" * (settings.max_audio_bytes + 1)))
    assert r.status_code == 413
    assert client.post("/voices/clone", data={"session_id": sid}, files=f(b"x")).status_code == 422
    assert synth.clone_calls == []


def test_m8_t05_designed_voice_persona(client, sid, synth):
    r = design(client, sid)
    assert r.status_code == 200
    b = r.json()
    assert b["persona"] == "designed_voice" and b["voice_id"] == "designed-voice-1"
    assert "not a clone" in b["note"]
    assert client.get(f"/sessions/{sid}").json()["voice_mode"] == "designed"
    cid = confirm(client, sid)["confirmed_id"]
    assert speak(client, sid, cid).headers["x-voice-persona"] == "designed_voice"
    assert client.post("/voices/design", json={"session_id": sid, "description": "  "}).status_code == 422
    assert client.post("/voices/design", json={"session_id": "nope", "description": "calm voice"}).status_code == 404
    assert client.post("/voices/design", json={"session_id": sid, "description": "x" * 1001}).status_code == 422


def test_m8_list_voices(client):
    assert client.get("/voices").json() == {"voices": [{"voice_id": "v1", "name": "Rachel", "category": "premade"}]}


# ------------------------------------------------------------------ errors / latency
def test_m8_t06_provider_failures_502(client, sid, synth):
    design(client, sid)
    cid = confirm(client, sid)["confirmed_id"]
    for exc in (AppError(502, "upstream_error", "Voice provider request failed"), RuntimeError("boom with details")):
        synth.fail = exc
        r = speak(client, sid, cid)
        assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"
        assert "boom" not in r.text
    synth.fail = None
    synth.chunks = []
    assert speak(client, sid, cid).status_code == 502  # silence is a failure, not success
    synth.chunks = [b"", b""]
    assert speak(client, sid, cid).status_code == 502
    synth.fail = AppError(502, "upstream_error", "x")
    assert design(client, sid).status_code == 502


def test_m8_t06b_missing_key_503():
    app = create_app(load_settings({}, use_dotenv=False))
    app.dependency_overrides[get_ranker] = lambda: LLMIntentRanker(FakeLLM())
    with TestClient(app) as c:
        s = c.post("/sessions").json()["session_id"]
        c.post(f"/sessions/{s}/turns/text", json={"speaker": "patient", "text": "water"})
        cid = confirm(c, s)["confirmed_id"]
        app.state.sessions.get(s).voice_id = "some-voice"  # a voice is set, but there is no key
        assert speak(c, s, cid).status_code == 503
        assert c.get("/voices").status_code == 503
        assert design(c, s).status_code == 503
        c.post(f"/sessions/{s}/consent", json={"voice_cloning": True})
        r = c.post("/voices/clone", data={"name": "n", "session_id": s}, files={"sample": ("a.wav", b"x", "audio/wav")})
        assert r.status_code == 503 and r.json()["error"]["code"] == "not_configured"


def test_m8_t07_first_audio_latency_recorded(client, app, sid, synth):
    design(client, sid)
    cid = confirm(client, sid)["confirmed_id"]
    synth.latency_ms = 120
    r = speak(client, sid, cid)
    assert r.headers["x-first-audio-ms"] == "120"
    assert app.state.speaklog.list(sid)[-1].tts_first_audio_ms == 120
    synth.latency_ms = 0
    assert speak(client, sid, cid).headers["x-first-audio-ms"] == "0"


def test_m8_t10_no_voice_selected_409(client, sid, synth):
    cid = confirm(client, sid)["confirmed_id"]
    r = speak(client, sid, cid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state"
    assert "voice" in r.json()["error"]["message"].lower()
    assert synth.stream_calls == []


def test_m8_default_voice_is_labelled(synth, fclock):
    s = load_settings({"DEFAULT_VOICE_ID": "default-1"}, use_dotenv=False)
    app = create_app(s, clock=fclock)
    app.dependency_overrides[get_synthesizer] = lambda: synth
    app.dependency_overrides[get_ranker] = lambda: LLMIntentRanker(FakeLLM())
    with TestClient(app) as c:
        sid = c.post("/sessions").json()["session_id"]
        c.post(f"/sessions/{sid}/turns/text", json={"speaker": "patient", "text": "water"})
        r = speak(c, sid, confirm(c, sid)["confirmed_id"])
    assert r.status_code == 200 and r.headers["x-voice-persona"] == "default_voice"
    assert synth.stream_calls[-1][1] == "default-1"


def test_m8_t09_clone_sample_not_left_on_disk(client, sid, synth, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    before = set(os.listdir(tempfile.gettempdir()))
    client.post(f"/sessions/{sid}/consent", json={"voice_cloning": True})
    marker = b"RIFF" + b"voice-sample-marker" * 50
    assert client.post("/voices/clone", data={"name": "me", "session_id": sid},
                       files={"sample": ("s.wav", marker, "audio/wav")}).status_code == 200
    assert synth.clone_calls[0][1] == marker  # forwarded from memory
    assert list(tmp_path.iterdir()) == []
    assert set(os.listdir(tempfile.gettempdir())) - before == set()
    # failure path does not leave it either
    synth.fail = AppError(502, "upstream_error", "x")
    assert client.post("/voices/clone", data={"name": "me", "session_id": sid},
                       files={"sample": ("s.wav", marker, "audio/wav")}).status_code == 502
    assert list(tmp_path.iterdir()) == [] and set(os.listdir(tempfile.gettempdir())) - before == set()


# ------------------------------------------------------------------ adapter (fake SDK client)
def sdk_settings(**env):
    return load_settings({"ELEVENLABS_API_KEY": "sk-test", **env}, use_dotenv=False)


class FakeSdk:
    def __init__(self, chunks=(b"a", b"", b"b"), exc=None):
        self.stream_kwargs = None
        self.exc = exc
        self.chunks = chunks
        self.created = {}
        outer = self

        async def stream(**kwargs):
            outer.stream_kwargs = kwargs
            if outer.exc:
                raise outer.exc
            for c in outer.chunks:
                yield c

        async def search():
            return SimpleNamespace(voices=[SimpleNamespace(voice_id="v9", name="Ana", category="premade")])

        async def ivc_create(**kwargs):
            outer.created["ivc"] = kwargs
            return SimpleNamespace(voice_id="ivc-1")

        async def design(**kwargs):
            outer.created["design"] = kwargs
            return SimpleNamespace(previews=[SimpleNamespace(generated_voice_id="gen-1"), SimpleNamespace(generated_voice_id="gen-2")])

        async def create(**kwargs):
            outer.created["create"] = kwargs
            return SimpleNamespace(voice_id="dv-1")

        self.text_to_speech = SimpleNamespace(stream=stream)
        self.voices = SimpleNamespace(search=search, ivc=SimpleNamespace(create=ivc_create))
        self.text_to_voice = SimpleNamespace(design=design, create=create)


async def collect(agen):
    return [c async for c in agen]


async def test_m8_t08_adapter_uses_flash_model_and_session_voice():
    sdk = FakeSdk()
    out = await collect(ElevenLabsSynthesizer(sdk_settings(), client=sdk).stream("नमस्ते", "voice-42"))
    assert out == [b"a", b"b"]  # empty chunks dropped
    assert sdk.stream_kwargs == {
        "voice_id": "voice-42", "text": "नमस्ते", "model_id": "eleven_flash_v2_5", "output_format": "mp3_44100_128",
    }
    sdk2 = FakeSdk()
    await collect(ElevenLabsSynthesizer(sdk_settings(TTS_MODEL="eleven_multilingual_v2"), client=sdk2).stream("x", "v"))
    assert sdk2.stream_kwargs["model_id"] == "eleven_multilingual_v2"  # follows config


async def test_m8_adapter_error_mapping_no_secret_leak(caplog):
    class Boom(Exception):
        status_code = 401

    t = ElevenLabsSynthesizer(sdk_settings(), client=FakeSdk(exc=Boom("sk-test rejected")))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(AppError) as ei:
            await collect(t.stream("x", "v"))
    assert ei.value.status == 502 and "sk-test" not in ei.value.message
    assert "sk-test" not in caplog.text and "check ELEVENLABS_API_KEY" in caplog.text
    with pytest.raises(AppError) as ei:
        await collect(ElevenLabsSynthesizer(load_settings({}, use_dotenv=False)).stream("x", "v"))
    assert ei.value.status == 503


async def test_m8_adapter_voice_calls():
    sdk = FakeSdk()
    t = ElevenLabsSynthesizer(sdk_settings(), client=sdk)
    assert await t.list_voices() == [VoiceInfo("v9", "Ana", "premade")]
    assert await t.clone_voice("me", b"data", "s.wav", "audio/wav") == "ivc-1"
    assert sdk.created["ivc"] == {"name": "me", "files": [("s.wav", b"data", "audio/wav")]}
    assert await t.design_voice("persona", "calm voice") == "dv-1"
    assert sdk.created["design"] == {"voice_description": "calm voice"}
    assert sdk.created["create"] == {"voice_name": "persona", "voice_description": "calm voice", "generated_voice_id": "gen-1"}


# ------------------------------------------------------------------ live
_live = load_settings()


@pytest.mark.live
@pytest.mark.skipif(not (_live.elevenlabs_api_key and _live.default_voice_id),
                    reason="ELEVENLABS_API_KEY and DEFAULT_VOICE_ID not set; live TTS test skipped")
async def test_m8_live_tts_short_sentence():
    chunks = await collect(ElevenLabsSynthesizer(_live).stream("I would like water, please.", _live.default_voice_id))
    assert sum(len(c) for c in chunks) > 1000
