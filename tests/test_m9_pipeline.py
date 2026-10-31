import asyncio
import json
from collections import deque

import cv2
import httpx
import numpy as np
import pytest

from clock import FakeClock
from config import load_settings
from main import create_app
from services.fusion import Completion, LLMIntentRanker, get_ranker
from services.scribe import BatchResult, get_transcriber
from services.tts import VoiceInfo, get_synthesizer
from services.vision import FaceObs, FrameObs, GestureObs, get_backend_factory

SCRIBE_MS, VISION_MS, FUSION_MS, TTS_MS = 300, 40, 200, 90
OPEN = {"jawOpen": 0.8, "mouthFunnel": 0.1}
CLOSED = {"jawOpen": 0.0, "mouthClose": 0.3}


def png() -> bytes:
    ok, buf = cv2.imencode(".png", np.zeros((8, 8, 3), np.uint8))
    return buf.tobytes()


class FakeTranscriber:
    def __init__(self, clock):
        self.clock, self.texts = clock, deque()

    async def transcribe(self, audio, filename, content_type, language_code):
        self.clock.advance(SCRIBE_MS)
        return BatchResult(self.texts.popleft(), "eng", 0.99, 1.0)

    async def open_realtime(self, language_code, handler):
        raise NotImplementedError


class FakeBackend:
    def __init__(self, clock):
        self.clock, self.script, self.closed = clock, deque(), False

    def analyze(self, rgb, ts):
        self.clock.advance(VISION_MS)
        face, gesture = self.script.popleft() if self.script else (None, None)
        return FrameObs(ts, face, gesture)

    def close(self):
        self.closed = True


class FakeFactory:
    def __init__(self, backend):
        self.backend = backend

    def create(self, mode):
        return self.backend


class FakeLLM:
    """Answers from the evidence packet it is given (so concurrent sessions can be told apart)."""

    def __init__(self, clock):
        self.clock, self.calls, self.override = clock, [], None

    async def complete(self, messages):
        self.calls.append(messages)
        await asyncio.sleep(0)  # yield so concurrent requests interleave
        self.clock.advance(FUSION_MS)
        if self.override is not None:
            return Completion(json.dumps(self.override))
        packet = json.loads(messages[1]["content"])
        word = packet["transcript"].split()[-1].strip(".!?").lower()
        return Completion(json.dumps({
            "intent": f"request_{word}",
            "candidate_replies": [f"I would like {word}, please.", f"Could I have some {word}?"],
            "clarification_required": False,
            "reasoning_summary": "Transcript and recent question align.",
        }))


class FakeSynth:
    def __init__(self, clock):
        self.clock, self.stream_calls, self.n = clock, [], 0

    async def stream(self, text, voice_id):
        self.stream_calls.append((text, voice_id))
        await asyncio.sleep(0)
        self.clock.advance(TTS_MS)
        yield b"ID3"
        yield text.encode("utf-8")

    async def list_voices(self):
        return [VoiceInfo("v", "n")]

    async def clone_voice(self, *a):
        return "x"

    async def design_voice(self, name, description):
        self.n += 1
        return f"voice-{self.n}"


class Rig:
    def __init__(self, tmp_path):
        self.clock = FakeClock(0)
        self.transcriber = FakeTranscriber(self.clock)
        self.backend = FakeBackend(self.clock)
        self.llm = FakeLLM(self.clock)
        self.synth = FakeSynth(self.clock)
        settings = load_settings({"LOGS_DIR": str(tmp_path / "logs")}, use_dotenv=False)
        self.app = create_app(settings, clock=self.clock)
        o = self.app.dependency_overrides
        o[get_transcriber] = lambda: self.transcriber
        o[get_backend_factory] = lambda: FakeFactory(self.backend)
        o[get_ranker] = lambda: LLMIntentRanker(self.llm)
        o[get_synthesizer] = lambda: self.synth
        self.logfile = tmp_path / "logs" / "turns.jsonl"


@pytest.fixture
def rig(tmp_path):
    return Rig(tmp_path)


@pytest.fixture
def aclient(rig):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=rig.app), base_url="http://test")


async def setup_session(c, consent=("audio_recording", "face_capture", "demo_use"), language="en"):
    sid = (await c.post("/sessions", json={"language": language})).json()["session_id"]
    await c.post(f"/sessions/{sid}/consent", json={k: True for k in consent})
    r = await c.post("/voices/design", json={"session_id": sid, "description": "A calm warm adult voice"})
    assert r.status_code == 200
    return sid


async def transcribe(c, rig, sid, speaker, text):
    rig.transcriber.texts.append(text)
    r = await c.post(f"/sessions/{sid}/transcribe", files={"audio": ("a.wav", b"RIFFxx", "audio/wav")}, data={"speaker": speaker})
    assert r.status_code == 200, r.text
    return r.json()


async def frames(c, rig, sid, n=4, gesture="Thumb_Up", score=0.91):
    for i in range(n):
        rig.backend.script.append((FaceObs(OPEN if i % 2 == 0 else CLOSED, 0.0), GestureObs(gesture, score, "Right")))
        r = await c.post(f"/sessions/{sid}/vision/frame", content=png())
        assert r.status_code == 200, r.text
        rig.clock.advance(60)


async def metrics(c, sid):
    return (await c.get(f"/sessions/{sid}/metrics")).json()["turns"]


async def happy_path(c, rig, sid, human_ms=5000):
    await transcribe(c, rig, sid, "partner", "Water or tea?")
    await frames(c, rig, sid)
    await transcribe(c, rig, sid, "patient", "wa... water")
    fin = await c.post(f"/sessions/{sid}/turn/finish", json={})
    assert fin.status_code == 200, fin.text
    prop = fin.json()["proposal"]
    rig.clock.advance(human_ms)  # the human decides
    conf = await c.post(f"/sessions/{sid}/proposals/{prop['proposal_id']}/confirm", json={"candidate_index": 0})
    assert conf.status_code == 200
    cid = conf.json()["confirmed"]["confirmed_id"]
    sp = await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})
    return fin.json(), cid, sp


# ------------------------------------------------------------------ happy path
async def test_m9_t01_happy_path_end_to_end(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        fin, cid, sp = await happy_path(c, rig, sid)
        ev = fin["evidence"]
        assert ev["transcript"] == "wa... water"
        assert ev["conversation_context"] == [{"speaker": "partner", "text": "Water or tea?"}]
        assert ev["visual_cues"]["gesture"] == {"label": "Thumb_Up", "score": 0.91, "meaning": "yes"}
        assert ev["visual_cues"]["mouth_activity"] is True
        assert fin["proposal"]["fusion"]["intent"] == "request_water" and fin["proposal"]["state"] == "pending"
        assert fin["clarification_message"] is None
        assert sp.status_code == 200 and sp.headers["content-type"] == "audio/mpeg"
        assert sp.content == b"ID3" + b"I would like water, please."
        assert rig.synth.stream_calls == [("I would like water, please.", "voice-1")]


async def test_m9_t02_conflicting_cues_clarification_and_no_speech(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        rig.llm.override = {"intent": "unclear", "candidate_replies": [], "clarification_required": True,
                            "reasoning_summary": "Gesture and transcript conflict."}
        await transcribe(c, rig, sid, "partner", "Do you want water?")
        await frames(c, rig, sid, gesture="Thumb_Down")
        await transcribe(c, rig, sid, "patient", "yes... w-")
        fin = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()
        assert fin["proposal"]["fusion"]["clarification_required"] is True
        assert fin["clarification_message"] == "I did not understand - please choose, repeat or clarify."
        pid = fin["proposal"]["proposal_id"]
        assert (await c.post(f"/sessions/{sid}/proposals/{pid}/confirm", json={"candidate_index": 0})).status_code == 409
        assert (await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": pid})).status_code == 409
        assert rig.synth.stream_calls == []  # /speak is impossible without a confirmed message


async def test_m9_t03_no_speech_clarifies_without_llm(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        # a blank patient turn can only come from the engine (typed/batch silence is never stored)
        rig.app.state.sessions.get(sid).conversation.add_turn("patient", "  ", "en", "scribe_realtime")
        fin = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()
        assert fin["proposal"]["fusion"]["clarification_required"] is True
        assert fin["proposal"]["fusion"]["candidate_replies"] == []
        assert rig.llm.calls == []
        assert rig.synth.stream_calls == []


async def test_m9_t04_reject_path_never_produces_audio(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "partner", "Water or tea?")
        await transcribe(c, rig, sid, "patient", "wa... water")
        pid = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()["proposal"]["proposal_id"]
        assert (await c.post(f"/sessions/{sid}/proposals/{pid}/reject")).status_code == 200
        for guess in (pid, "0" * 32):
            assert (await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": guess})).status_code in (404, 409)
        assert rig.synth.stream_calls == []
        m = (await metrics(c, sid))[-1]
        assert m["confirmed_ms"] is None and m["first_audio_ms"] is None and m["system_latency_ms"] is None


# ------------------------------------------------------------------ timings
async def test_m9_t05_timing_fields_present_and_non_negative(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await happy_path(c, rig, sid)
        m = (await metrics(c, sid))[-1]
        for key in ("scribe_ms", "vision_ms", "fusion_ms", "tts_first_audio_ms", "finish_received_ms",
                    "proposal_ready_ms", "confirmed_ms", "speak_received_ms", "first_audio_ms",
                    "system_latency_ms", "wall_clock_ms", "human_wait_ms"):
            assert isinstance(m[key], int) and m[key] >= 0, key
        # each stage is measured separately from the fakes' known durations
        assert (m["scribe_ms"], m["vision_ms"], m["fusion_ms"], m["tts_first_audio_ms"]) == (SCRIBE_MS, VISION_MS, FUSION_MS, TTS_MS)
        assert m["language"] == "en" and m["transcript_raw"] == "wa... water" and m["intent"] == "request_water"
        assert m["clarification_required"] is False and m["reference_transcript"] is None


async def test_m9_t06_system_latency_excludes_human_wait(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await happy_path(c, rig, sid, human_ms=60_000)
        m = (await metrics(c, sid))[-1]
        assert m["human_wait_ms"] == 60_000
        assert m["system_latency_ms"] == FUSION_MS + TTS_MS
        assert m["wall_clock_ms"] == FUSION_MS + 60_000 + TTS_MS
        assert m["wall_clock_ms"] == m["system_latency_ms"] + m["human_wait_ms"]


async def test_m9_replay_does_not_change_chain_timings(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        _, cid, _ = await happy_path(c, rig, sid)
        before = (await metrics(c, sid))[-1]
        rig.clock.advance(10_000)
        assert (await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})).status_code == 200
        assert (await metrics(c, sid))[-1] == before


async def test_m9_refuse_chain_uses_latest_attempt_stamps(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "patient", "wa... water")
        p1 = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()["proposal"]
        await c.post(f"/sessions/{sid}/proposals/{p1['proposal_id']}/reject")
        rig.clock.advance(30_000)  # patient stares at the screen, then asks again
        p2 = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()["proposal"]
        cid = (await c.post(f"/sessions/{sid}/proposals/{p2['proposal_id']}/confirm", json={"candidate_index": 1})).json()["confirmed"]["confirmed_id"]
        await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})
        ms = await metrics(c, sid)
        assert len(ms) == 1  # one chain
        assert ms[0]["system_latency_ms"] == FUSION_MS + TTS_MS  # the rejected attempt's wait is not included


async def test_m9_vision_ms_absent_without_frames_and_finish_toggle(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await transcribe(c, rig, sid, "patient", "water")
        fin = (await c.post(f"/sessions/{sid}/turn/finish", json={"include_visual_cues": False})).json()
        assert fin["evidence"]["visual_cues"] == {"gesture": None, "mouth_activity": False, "head_nod": False}
        assert (await metrics(c, sid))[-1]["vision_ms"] is None


# ------------------------------------------------------------------ concurrency
async def test_m9_t07_concurrent_sessions_stay_isolated(rig, aclient):
    lock = asyncio.Lock()  # the fake transcriber hands out its lines in call order; keep each call paired

    async def flow(c, partner_q, patient_text):
        sid = await setup_session(c)
        for speaker, text in (("partner", partner_q), ("patient", patient_text)):
            async with lock:
                rig.transcriber.texts.append(text)
                r = await c.post(f"/sessions/{sid}/transcribe", files={"audio": ("a.wav", b"RIFFxx", "audio/wav")}, data={"speaker": speaker})
            assert r.status_code == 200
        fin = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()  # LLM calls interleave here
        pid = fin["proposal"]["proposal_id"]
        cid = (await c.post(f"/sessions/{sid}/proposals/{pid}/confirm", json={"candidate_index": 0})).json()["confirmed"]["confirmed_id"]
        sp = await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})
        return sid, fin, sp

    async with aclient as c:
        (sa, fa, spa), (sb, fb, spb) = await asyncio.gather(
            flow(c, "Water or tea?", "wa... water"), flow(c, "Bread or rice?", "ri... rice")
        )
        assert sa != sb
        for sid, fin, sp, word, question in ((sa, fa, spa, "water", "Water or tea?"), (sb, fb, spb, "rice", "Bread or rice?")):
            assert fin["evidence"]["transcript"].endswith(word)
            assert [t["text"] for t in fin["evidence"]["conversation_context"]] == [question]
            assert sp.status_code == 200 and sp.content == b"ID3" + f"I would like {word}, please.".encode()
            hist = (await c.get(f"/sessions/{sid}/history")).json()["turns"]
            assert len(hist) == 2 and hist[1]["text"].endswith(word)
            ms = await metrics(c, sid)
            assert len(ms) == 1 and ms[0]["intent"] == f"request_{word}" and ms[0]["session_id"] == sid
        assert sorted(v for _, v in rig.synth.stream_calls) == ["voice-1", "voice-2"]  # each session its own voice
        # a message confirmed in one session cannot be spoken from the other
        cid_a = rig.app.state.proposals.list_confirmed(sa)[0].confirmed_id
        assert (await c.post(f"/sessions/{sb}/speak", json={"confirmed_id": cid_a})).status_code == 404


# ------------------------------------------------------------------ logging
async def test_m9_t08_jsonl_written_only_with_demo_consent(rig, aclient):
    async with aclient as c:
        no_demo = await setup_session(c, consent=("audio_recording", "face_capture"))
        await happy_path(c, rig, no_demo)
        assert not rig.logfile.exists()  # nothing on disk without demo_use...
        assert len(await metrics(c, no_demo)) == 1  # ...but metrics stay in memory

        sid = await setup_session(c, language="mixed")
        _, cid, _ = await happy_path(c, rig, sid)
        assert (await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})).status_code == 200  # replay
        lines = rig.logfile.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1  # one line per chain, not per speak
        rec = json.loads(lines[0])
        for key in ("session_id", "turn_id", "language", "transcript_raw", "reference_transcript", "intent",
                    "clarification_required", "scribe_ms", "vision_ms", "fusion_ms", "tts_first_audio_ms",
                    "finish_received_ms", "proposal_ready_ms", "confirmed_ms", "speak_received_ms",
                    "first_audio_ms", "system_latency_ms", "wall_clock_ms", "human_wait_ms"):
            assert key in rec, key
        assert rec["session_id"] == sid and rec["language"] == "mixed" and rec["transcript_raw"] == "wa... water"
        assert rec["reference_transcript"] is None and rec["intent"] == "request_water"
        assert rec["system_latency_ms"] == FUSION_MS + TTS_MS


async def test_m9_jsonl_keeps_devanagari_and_respects_withdrawn_consent(rig, aclient):
    rig.llm.override = {"intent": "request_water", "candidate_replies": ["मुझे पानी चाहिए।", "क्या मुझे पानी मिल सकता है?"],
                        "clarification_required": False, "reasoning_summary": "ok"}
    async with aclient as c:
        sid = await setup_session(c, language="hi")
        await transcribe(c, rig, sid, "patient", "मुझे पानी चाहिए")
        pid = (await c.post(f"/sessions/{sid}/turn/finish", json={})).json()["proposal"]["proposal_id"]
        cid = (await c.post(f"/sessions/{sid}/proposals/{pid}/confirm", json={"candidate_index": 0})).json()["confirmed"]["confirmed_id"]
        await c.post(f"/sessions/{sid}/consent", json={"audio_recording": True})  # demo_use withdrawn
        await c.post(f"/sessions/{sid}/speak", json={"confirmed_id": cid})
        assert not rig.logfile.exists()
        sid2 = await setup_session(c, language="hi")
        await transcribe(c, rig, sid2, "patient", "मुझे पानी चाहिए")
        pid = (await c.post(f"/sessions/{sid2}/turn/finish", json={})).json()["proposal"]["proposal_id"]
        cid = (await c.post(f"/sessions/{sid2}/proposals/{pid}/confirm", json={"candidate_index": 0})).json()["confirmed"]["confirmed_id"]
        await c.post(f"/sessions/{sid2}/speak", json={"confirmed_id": cid})
        assert json.loads(rig.logfile.read_text(encoding="utf-8"))["transcript_raw"] == "मुझे पानी चाहिए"


# ------------------------------------------------------------------ errors
async def test_m9_t09_finish_without_patient_turn_409(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        r = await c.post(f"/sessions/{sid}/turn/finish", json={})
        assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state"
        await transcribe(c, rig, sid, "partner", "Hello?")
        assert (await c.post(f"/sessions/{sid}/turn/finish")).status_code == 409
        assert (await c.post("/sessions/nope/turn/finish", json={})).status_code == 404
        assert (await c.post(f"/sessions/{sid}/turn/finish", json={"turn_id": "x"})).status_code == 422  # nothing beyond the flow
        assert (await c.get("/sessions/nope/metrics")).status_code == 404
        assert await metrics(c, sid) == []  # partner turns and failed finishes create no chain


async def test_m9_metrics_removed_with_session(rig, aclient):
    async with aclient as c:
        sid = await setup_session(c)
        await happy_path(c, rig, sid)
        assert rig.app.state.metrics.list(sid)
        await c.delete(f"/sessions/{sid}")
        assert rig.app.state.metrics.list(sid) == []
