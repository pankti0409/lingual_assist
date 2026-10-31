import numpy as np
import pytest

from clock import FakeClock
from main import create_app
from services.vision import FaceObs, FrameObs, GestureObs

OPEN = {"jawOpen": 0.8, "mouthFunnel": 0.1}
CLOSED = {"jawOpen": 0.0, "mouthClose": 0.3}
ALLOWED_KEYS = {
    "speaker", "transcript", "language", "timestamp_ms", "conversation_context", "visual_cues",
    "text", "gesture", "mouth_activity", "head_nod", "label", "score", "meaning",
}


@pytest.fixture
def fclock():
    return FakeClock(0)


@pytest.fixture
def app(settings, fclock):
    return create_app(settings, clock=fclock)


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/consent", json={"face_capture": True})
    return s


def say(client, sid, speaker, text, **kw):
    r = client.post(f"/sessions/{sid}/turns/text", json={"speaker": speaker, "text": text, **kw})
    assert r.status_code == 201
    return r.json()


def feed(app, sid, frames):
    """frames: [(ts, mouth, gesture)] straight into the session's cue tracker."""
    tr = app.state.vision.for_session(sid).tracker
    for ts, mouth, g in frames:
        tr.observe(FrameObs(ts, FaceObs(mouth=mouth, pitch_deg=0.0), g))


def thumb(score=0.91):
    return GestureObs("Thumb_Up", score, "Right")


def evidence(client, sid, **body):
    return client.post(f"/sessions/{sid}/evidence", json=body)


def water_scenario(client, app, sid, fclock):
    say(client, sid, "partner", "Water or tea?")
    fclock.advance(11900)
    feed(app, sid, [(11900 + i * 100, OPEN if i % 2 == 0 else CLOSED, thumb()) for i in range(6)])
    fclock.advance(500)  # now 12400
    return say(client, sid, "patient", "wa... water")


def test_m5_t01_water_scenario_equals_blueprint_example(client, app, sid, fclock):
    turn = water_scenario(client, app, sid, fclock)
    assert turn["timestamp_ms"] == 12400
    r = evidence(client, sid)
    assert r.status_code == 200
    assert r.json() == {
        "speaker": "patient",
        "transcript": "wa... water",
        "language": "en",
        "timestamp_ms": 12400,
        "conversation_context": [{"speaker": "partner", "text": "Water or tea?"}],
        "visual_cues": {
            "gesture": {"label": "Thumb_Up", "score": 0.91, "meaning": "yes"},
            "mouth_activity": True,
            "head_nod": False,
        },
    }
    assert list(r.json().keys()) == ["speaker", "transcript", "language", "timestamp_ms", "conversation_context", "visual_cues"]


def test_m5_t02_stale_lowscore_unstable_gestures_dropped(client, app, sid, fclock, settings):
    # stale: last cue older than CUE_MAX_AGE_MS at the turn
    feed(app, sid, [(i * 100, CLOSED, thumb()) for i in range(4)])
    fclock.advance(300 + settings.cue_max_age_ms + 1)
    say(client, sid, "patient", "water")
    assert evidence(client, sid).json()["visual_cues"]["gesture"] is None
    # low score
    feed(app, sid, [(5000 + i * 100, CLOSED, thumb(settings.gesture_min_score - 0.01)) for i in range(4)])
    fclock.advance(5000 - fclock.now_ms() + 400)
    say(client, sid, "patient", "water again")
    assert evidence(client, sid).json()["visual_cues"]["gesture"] is None
    # single (unstable) gesture frame is not sent as truth
    feed(app, sid, [(9000, CLOSED, thumb())])
    fclock.advance(9000 - fclock.now_ms() + 50)
    say(client, sid, "patient", "third")
    assert evidence(client, sid).json()["visual_cues"]["gesture"] is None


def test_m5_cues_after_the_turn_are_not_used(client, app, sid, fclock):
    say(client, sid, "patient", "water")  # turn at t=0
    feed(app, sid, [(100 + i * 100, CLOSED, thumb()) for i in range(4)])  # cues arrive later
    assert evidence(client, sid).json()["visual_cues"]["gesture"] is None


def test_m5_unmapped_gesture_has_null_meaning(client, app, sid, fclock):
    client.put(f"/sessions/{sid}/gesture-map", json={"Victory": "call nurse"})
    feed(app, sid, [(i * 100, CLOSED, thumb()) for i in range(4)])
    fclock.advance(400)
    say(client, sid, "patient", "x")
    g = evidence(client, sid).json()["visual_cues"]["gesture"]
    assert g["label"] == "Thumb_Up" and g["meaning"] is None


def test_m5_t03_context_window_chronological_excludes_current(client, sid, fclock):
    for i in range(8):
        fclock.advance(10)
        say(client, sid, "partner" if i % 2 == 0 else "patient", f"turn{i}")
    cur = say(client, sid, "patient", "CURRENT")
    say(client, sid, "partner", "after-the-turn")  # later turns must not leak into the context
    ctx = evidence(client, sid, turn_id=cur["turn_id"]).json()["conversation_context"]
    assert [c["text"] for c in ctx] == [f"turn{i}" for i in range(2, 8)]  # window = 6, oldest first
    assert "CURRENT" not in [c["text"] for c in ctx] and "after-the-turn" not in [c["text"] for c in ctx]
    assert [c["speaker"] for c in ctx] == ["partner", "patient"] * 3


def test_m5_default_is_latest_patient_turn_even_after_partner_reply(client, sid):
    say(client, sid, "patient", "first")
    say(client, sid, "partner", "reply")
    say(client, sid, "patient", "latest")
    say(client, sid, "partner", "trailing")
    p = evidence(client, sid).json()
    assert p["transcript"] == "latest"
    assert [c["text"] for c in p["conversation_context"]] == ["first", "reply"]


def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert k in ALLOWED_KEYS, f"unexpected key {path}/{k}"
            yield from _walk(v, f"{path}/{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")
    else:
        assert not isinstance(obj, (bytes, bytearray, np.ndarray)), f"raw media at {path}"
        yield obj


def test_m5_t04_no_raw_media_fields(client, app, sid, fclock):
    water_scenario(client, app, sid, fclock)
    p = evidence(client, sid).json()
    leaves = list(_walk(p))
    assert leaves and all(isinstance(v, (str, int, float, bool, type(None))) for v in leaves)
    assert len(str(p)) < 600  # compact by construction


def test_m5_t05_no_cues_at_all(client, sid):
    say(client, sid, "patient", "hello")
    r = evidence(client, sid)
    assert r.status_code == 200
    assert r.json()["visual_cues"] == {"gesture": None, "mouth_activity": False, "head_nod": False}
    assert r.json()["conversation_context"] == []


def test_m5_t06_deterministic(client, app, sid, fclock):
    water_scenario(client, app, sid, fclock)
    fclock.advance(5000)  # time passing alone does not change the packet for the same turn
    assert evidence(client, sid).json() == evidence(client, sid).json()


def test_m5_t07_include_visual_cues_false_strips_cues_only(client, app, sid, fclock):
    water_scenario(client, app, sid, fclock)
    full = evidence(client, sid).json()
    bare = evidence(client, sid, include_visual_cues=False).json()
    assert bare["visual_cues"] == {"gesture": None, "mouth_activity": False, "head_nod": False}
    assert {k: v for k, v in bare.items() if k != "visual_cues"} == {k: v for k, v in full.items() if k != "visual_cues"}
    assert full["visual_cues"]["gesture"] is not None  # sanity: the cues really were there


def test_m5_t08_no_patient_turn_and_unknown_turn(client, sid):
    r = evidence(client, sid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state"
    say(client, sid, "partner", "hello?")
    assert evidence(client, sid).status_code == 409  # a partner turn alone is not enough
    r = evidence(client, sid, turn_id="deadbeef")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.post("/sessions/nope/evidence", json={}).status_code == 404


def test_m5_t09_partner_turn_id_rejected(client, sid):
    p = say(client, sid, "partner", "Water or tea?")
    say(client, sid, "patient", "water")
    r = evidence(client, sid, turn_id=p["turn_id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_m5_language_follows_turn(client):
    s = client.post("/sessions", json={"language": "hi"}).json()["session_id"]
    say(client, s, "patient", "paani")
    assert evidence(client, s).json()["language"] == "hi"
    say(client, s, "patient", "water", language="en")
    assert evidence(client, s).json()["language"] == "en"


def test_m5_request_validation_and_empty_body(client, sid):
    say(client, sid, "patient", "hi")
    assert client.post(f"/sessions/{sid}/evidence").status_code == 200  # body optional
    assert evidence(client, sid, include_visual_cues="maybe").status_code == 422
    assert evidence(client, sid, extra=1).status_code == 422


def test_m5_withdrawn_face_consent_drops_cues(client, app, sid, fclock):
    water_scenario(client, app, sid, fclock)
    assert evidence(client, sid).json()["visual_cues"]["gesture"] is not None
    client.post(f"/sessions/{sid}/consent", json={})
    assert evidence(client, sid).json()["visual_cues"] == {"gesture": None, "mouth_activity": False, "head_nod": False}


def test_m5_building_a_packet_changes_no_state(client, sid):
    say(client, sid, "patient", "hi")
    before = client.get(f"/sessions/{sid}/history").json()
    evidence(client, sid)
    assert client.get(f"/sessions/{sid}/history").json() == before
