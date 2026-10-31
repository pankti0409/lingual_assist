import logging
import math
import os
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from clock import FakeClock
from config import load_settings
from main import create_app
from services.vision import (
    CueTracker,
    FaceObs,
    FrameObs,
    GestureObs,
    LiveMerger,
    count_swings,
    face_obs_from_result,
    get_backend_factory,
    gesture_obs_from_result,
)

OPEN = {"jawOpen": 0.8, "mouthFunnel": 0.1}
CLOSED = {"jawOpen": 0.0, "mouthClose": 0.3}
ASSETS = Path(__file__).resolve().parent.parent / "assets"


def png(color_bgr=(0, 0, 255), size=(8, 8)) -> bytes:
    img = np.zeros((size[1], size[0], 3), np.uint8)
    img[:] = color_bgr
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


class FakeBackend:
    """Scripted backend: each analyze() pops the next (face, gesture) pair."""

    def __init__(self):
        self.script: deque = deque()
        self.calls: list[tuple[np.ndarray, int]] = []
        self.closed = False
        self.gate: threading.Event | None = None

    def push(self, face=None, gesture=None):
        self.script.append((face, gesture))

    def analyze(self, rgb, ts):
        if self.gate is not None:
            self.gate.wait(timeout=5)
        self.calls.append((rgb.copy(), ts))
        face, gesture = self.script.popleft() if self.script else (None, None)
        return FrameObs(ts, face, gesture)

    def close(self):
        self.closed = True


class FakeFactory:
    def __init__(self, backend):
        self.backend = backend
        self.modes: list[str] = []

    def create(self, mode):
        self.modes.append(mode)
        return self.backend


def face(mouth=None, pitch=0.0):
    return FaceObs(mouth=mouth if mouth is not None else CLOSED, pitch_deg=pitch)


def thumb(score=0.9, label="Thumb_Up"):
    return GestureObs(label=label, score=score, handedness="Right")


@pytest.fixture
def fclock():
    return FakeClock(1000)


@pytest.fixture
def backend():
    return FakeBackend()


@pytest.fixture
def app(settings, fclock, backend):
    app = create_app(settings, clock=fclock)
    app.dependency_overrides[get_backend_factory] = lambda: FakeFactory(backend)
    return app


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/consent", json={"face_capture": True})
    return s


def post(client, sid, data=None, **kw):
    return client.post(f"/sessions/{sid}/vision/frame", content=png() if data is None else data, **kw)


def obs(ts, f=None, g=None):
    return FrameObs(ts, f, g)


def tracker(settings=None):
    return CueTracker(settings or load_settings({}, use_dotenv=False))


# ---------------------------------------------------------------- HTTP / service
def test_m4_t01_valid_image_returns_structured_cue(client, sid, backend, fclock):
    backend.push(face(OPEN), thumb())
    r = post(client, sid, headers={"content-type": "image/png"})
    assert r.status_code == 200
    b = r.json()
    assert b["timestamp_ms"] == 0  # session clock, not wall time
    assert b["face"] == {"detected": True, "mouth_activity": False, "mouth_score": 0.0, "head_nod": False}
    assert b["gesture"]["label"] == "Thumb_Up" and b["gesture"]["meaning"] == "yes"
    assert b["gesture"]["stable"] is False  # one frame is never stable
    assert b["mirrored"] is None
    fclock.advance(200)
    backend.push(face(OPEN))
    assert post(client, sid).json()["timestamp_ms"] == 200


def test_m4_t01b_multipart_and_mirrored_echo(client, sid, backend):
    backend.push(face())
    r = client.post(
        f"/sessions/{sid}/vision/frame", files={"file": ("f.png", png(), "image/png")}, data={"mirrored": "true"}
    )
    assert r.status_code == 200 and r.json()["mirrored"] is True
    r = client.post(f"/sessions/{sid}/vision/frame?mirrored=false", content=png())
    assert r.json()["mirrored"] is False
    assert client.post(f"/sessions/{sid}/vision/frame", data={"x": "1"}, files={"other": ("a", b"b")}).status_code == 422


def test_m4_t02_no_face_no_hand(client, sid):
    r = post(client, sid)  # backend default: nothing detected
    assert r.status_code == 200
    b = r.json()
    assert b["face"] == {"detected": False, "mouth_activity": False, "mouth_score": 0.0, "head_nod": False}
    assert b["gesture"] is None


def test_m4_t03_corrupt_empty_and_oversized(client, sid, settings):
    r = post(client, sid, data=b"this is not an image")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert post(client, sid, data=b"").status_code == 422
    r = post(client, sid, data=b"\x00" * (settings.max_frame_bytes + 1))
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


def test_m4_t04_stale_cue_not_current(client, sid, backend, fclock, settings):
    backend.push(face())
    post(client, sid)
    fclock.advance(settings.cue_max_age_ms)
    r = client.get(f"/sessions/{sid}/vision/cues").json()
    assert r["cue"] is not None and r["stale"] is False
    fclock.advance(1)
    r = client.get(f"/sessions/{sid}/vision/cues").json()
    assert r == {"cue": None, "stale": True}


def test_m4_t04b_no_frames_yet(client, sid):
    assert client.get(f"/sessions/{sid}/vision/cues").json() == {"cue": None, "stale": False}


def test_m4_t05_low_score_gesture_ignored(client, sid, backend, settings):
    backend.push(face(), thumb(score=settings.gesture_min_score - 0.01))
    assert post(client, sid).json()["gesture"] is None
    backend.push(face(), GestureObs("None", 0.99, None))
    assert post(client, sid).json()["gesture"] is None
    backend.push(face(), thumb(score=settings.gesture_min_score))
    assert post(client, sid).json()["gesture"]["label"] == "Thumb_Up"


# ---------------------------------------------------------------- tracker logic
def test_m4_t06_gesture_stability_needs_consecutive_frames_and_flicker_resets():
    t = tracker()
    gm = {"Thumb_Up": "yes"}
    results = []
    for i, g in enumerate([thumb(), thumb(), thumb(), thumb(label="Victory"), thumb(), thumb(), thumb()]):
        t.observe(obs(i * 200, face(), g))
        results.append(t.current(i * 200, gm).gesture.stable)
    assert results == [False, False, True, False, False, False, True]
    # a frame with no hand also breaks the run
    t2 = tracker()
    for i, g in enumerate([thumb(), thumb(), None, thumb()]):
        t2.observe(obs(i * 100, face(), g))
    assert t2.current(300, gm).gesture.stable is False
    # a low-score frame inside the run breaks it too
    t3 = tracker()
    for i, g in enumerate([thumb(), thumb(0.3), thumb()]):
        t3.observe(obs(i * 100, face(), g))
    assert t3.current(200, gm).gesture.stable is False


def test_m4_t06b_stability_requires_fresh_frames():
    t = tracker()
    t.observe(obs(0, face(), thumb()))
    t.observe(obs(100, face(), thumb()))
    t.observe(obs(5000, face(), thumb()))  # gap far beyond CUE_MAX_AGE_MS
    assert t.current(5000, {}).gesture.stable is False


def test_m4_t07_mouth_activity_is_windowed():
    t = tracker()
    seq = [CLOSED, CLOSED, CLOSED, OPEN, CLOSED, CLOSED]  # one open frame among closed
    for i, m in enumerate(seq):
        t.observe(obs(i * 100, face(m)))
    assert t.current(500, {}).face.mouth_activity is False
    # only two frames in window -> never active
    t2 = tracker()
    t2.observe(obs(0, face(CLOSED)))
    t2.observe(obs(100, face(OPEN)))
    assert t2.current(100, {}).face.mouth_activity is False
    # sustained variation -> active
    t3 = tracker()
    for i, m in enumerate([OPEN, CLOSED, OPEN, CLOSED, OPEN, CLOSED]):
        t3.observe(obs(i * 100, face(m)))
    c = t3.current(500, {}).face
    assert c.mouth_activity is True and c.mouth_score > 0.5
    # old movement leaves the window
    for i in range(6):
        t3.observe(obs(2000 + i * 100, face(CLOSED)))
    assert t3.current(2500, {}).face.mouth_activity is False


def test_m4_t08_head_nod_needs_oscillation():
    def run(pitches):
        t = tracker()
        for i, p in enumerate(pitches):
            t.observe(obs(i * 100, face(pitch=p)))
        return t.current((len(pitches) - 1) * 100, {}).face.head_nod

    assert run([0, 0, 0, 0, 0, 0]) is False
    assert run([0, 2, 5, 8, 10, 10]) is False          # single tilt
    assert run([0, 8, 8, 0, 0, 0]) is False            # tilt and return = 2 swings
    assert run([0, 8, 0, 8, 0, 0]) is True             # oscillation
    assert run([0, 1, -1, 1, -1, 1]) is False          # tremor below threshold
    assert run([0, 8, 0]) is False                     # too few frames


def test_m4_swing_counter():
    assert count_swings([], 4) == 0
    assert count_swings([0, 5, 0, 5, 0], 4) == 4
    assert count_swings([0, 3, 0, 3], 4) == 0


def test_m4_t05_t06_gesture_meaning_from_map_only():
    t = tracker()
    for i in range(3):
        t.observe(obs(i * 100, face(), thumb(label="Victory")))
    g = t.current(200, {"Thumb_Up": "yes"}).gesture
    assert g.stable and g.meaning is None  # no calibrated meaning -> none invented
    assert t.current(200, {"Victory": "peace"}).gesture.meaning == "peace"


# ---------------------------------------------------------------- gesture map
def test_m4_t09_gesture_map_validation(client, sid, backend):
    demo = {"Thumb_Up": "yes", "Open_Palm": "pause", "Thumb_Down": "no"}
    r = client.put(f"/sessions/{sid}/gesture-map", json=demo)
    assert r.status_code == 200 and r.json() == {"gesture_map": demo}
    for bad in ({"Thumbs_Sideways": "maybe"}, {"Thumb_Up": ""}, {"Thumb_Up": "   "}, {"Thumb_Up": "x" * 41}):
        r = client.put(f"/sessions/{sid}/gesture-map", json=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error", bad
    assert client.put(f"/sessions/{sid}/gesture-map", json={"Thumb_Up": "x" * 40}).status_code == 200
    # custom map is used for meaning
    client.put(f"/sessions/{sid}/gesture-map", json={"Victory": "call nurse"})
    backend.push(face(), thumb(label="Victory"))
    assert post(client, sid).json()["gesture"]["meaning"] == "call nurse"
    backend.push(face(), thumb(label="Thumb_Up"))
    assert post(client, sid).json()["gesture"]["meaning"] is None
    assert client.put("/sessions/nope/gesture-map", json={}).status_code == 404


def test_m4_t09b_default_map_is_demo_map(client, sid, backend):
    backend.push(face(), thumb(label="Thumb_Down"))
    assert post(client, sid).json()["gesture"]["meaning"] == "no"


# ---------------------------------------------------------------- consent / privacy
def test_m4_t10_requires_face_capture_consent(client, backend):
    s = client.post("/sessions").json()["session_id"]
    for call in (lambda: post(client, s), lambda: client.get(f"/sessions/{s}/vision/cues")):
        r = call()
        assert r.status_code == 403 and r.json()["error"]["code"] == "consent_required"
        assert "face_capture" in r.json()["error"]["message"]
    assert backend.calls == []
    # consent for another purpose is not enough
    client.post(f"/sessions/{s}/consent", json={"audio_recording": True})
    assert post(client, s).status_code == 403
    client.post(f"/sessions/{s}/consent", json={"face_capture": True})
    assert post(client, s).status_code == 200
    client.post(f"/sessions/{s}/consent", json={})  # withdrawn
    assert post(client, s).status_code == 403


def _holds_raw_media(obj, seen=None, depth=0) -> bool:
    seen = set() if seen is None else seen
    if id(obj) in seen or depth > 6:
        return False
    seen.add(id(obj))
    if isinstance(obj, (bytes, bytearray, np.ndarray)):
        return True
    if isinstance(obj, dict):
        return any(_holds_raw_media(v, seen, depth + 1) for v in obj.values())
    if isinstance(obj, (list, tuple, set, deque)):
        return any(_holds_raw_media(v, seen, depth + 1) for v in obj)
    if hasattr(obj, "__dict__"):
        return any(_holds_raw_media(v, seen, depth + 1) for k, v in vars(obj).items() if k not in ("backends", "lock"))
    return False


def test_m4_t11_no_raw_frame_persisted(client, app, sid, backend, caplog, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    before = set(os.listdir(tempfile.gettempdir()))
    marker = png((13, 37, 99), size=(9, 9))
    for _ in range(3):
        backend.push(face(OPEN), thumb())
        with caplog.at_level(logging.DEBUG):
            assert post(client, sid, data=marker).status_code == 200
    vs = app.state.vision.for_session(sid)
    assert not _holds_raw_media(vs)
    assert not _holds_raw_media(app.state.sessions.get(sid))
    assert list(tmp_path.iterdir()) == []
    assert set(os.listdir(tempfile.gettempdir())) - before == set()
    assert repr(marker[:16]) not in caplog.text and marker.hex()[:32] not in caplog.text
    assert _holds_raw_media({"x": b"sanity"})  # the checker itself works


def test_m4_t12_bgr_to_rgb_applied(client, sid, backend):
    backend.push(face())
    assert post(client, sid, data=png((0, 0, 255))).status_code == 200  # BGR red
    rgb, _ = backend.calls[0]
    assert rgb.shape == (8, 8, 3) and rgb.dtype == np.uint8 and rgb.flags["C_CONTIGUOUS"]
    assert tuple(rgb[0, 0]) == (255, 0, 0)  # RGB red, not blue


def test_m4_large_image_is_downscaled(client, sid, backend):
    big = png(size=(1280, 960))
    assert post(client, sid, data=big).status_code == 200
    h, w = backend.calls[0][0].shape[:2]
    assert max(h, w) == 640 and (w, h) == (640, 480)


# ---------------------------------------------------------------- websocket
def test_m4_t13_ws_frames_in_cues_out(client, sid, backend, fclock):
    with client.websocket_connect(f"/ws/sessions/{sid}/vision") as ws:
        backend.push(face(OPEN), thumb())
        ws.send_bytes(png())
        msg = ws.receive_json()
        assert msg["dropped_frames"] == 0
        assert msg["cue"]["face"]["detected"] is True and msg["cue"]["gesture"]["label"] == "Thumb_Up"
        ws.send_bytes(b"garbage")
        err = ws.receive_json()["error"]
        assert err["code"] == "validation_error" and err["request_id"]
        ws.send_bytes(png())  # connection survives bad frames
        assert ws.receive_json()["cue"] is not None


def test_m4_t13b_ws_slow_consumer_drops_frames(client, app, sid, backend):
    backend.gate = threading.Event()
    vs = app.state.vision.for_session(sid)
    with client.websocket_connect(f"/ws/sessions/{sid}/vision") as ws:
        for _ in range(5):
            ws.send_bytes(png())
        deadline = time.time() + 5
        while vs.dropped_frames < 3 and time.time() < deadline:
            time.sleep(0.01)
        assert vs.dropped_frames >= 3  # frames piled up behind the busy backend were dropped
        backend.gate.set()
        first = ws.receive_json()
        assert first["cue"] is not None
        second = ws.receive_json()
        assert second["dropped_frames"] >= 3
    # far fewer than 5 frames reached the backend: older ones were dropped, not queued
    assert len(backend.calls) <= 2


def test_m4_ws_rejects_without_consent_and_unknown_session(client, backend):
    s = client.post("/sessions").json()["session_id"]
    with client.websocket_connect(f"/ws/sessions/{s}/vision") as ws:
        assert ws.receive_json()["error"]["code"] == "consent_required"
    with client.websocket_connect("/ws/sessions/nope/vision") as ws:
        assert ws.receive_json()["error"]["code"] == "not_found"
    assert backend.calls == []


def test_m4_ws_uses_live_mode_and_post_uses_image_mode(app, sid, backend):
    factory = FakeFactory(backend)
    app.dependency_overrides[get_backend_factory] = lambda: factory
    with TestClient(app) as c:
        post(c, sid)
        with c.websocket_connect(f"/ws/sessions/{sid}/vision") as ws:
            ws.send_bytes(png())
            ws.receive_json()
    assert factory.modes == ["image", "live"]


# ---------------------------------------------------------------- config / lifecycle
def test_m4_t14_missing_models_503(tmp_path):
    s = load_settings({"ASSETS_DIR": str(tmp_path)}, use_dotenv=False)
    app = create_app(s)  # default factory, no override
    with TestClient(app) as c:
        sid = c.post("/sessions").json()["session_id"]
        c.post(f"/sessions/{sid}/consent", json={"face_capture": True})
        r = c.post(f"/sessions/{sid}/vision/frame", content=png())
        assert r.status_code == 503
        e = r.json()["error"]
        assert e["code"] == "not_configured" and "face_landmarker.task" in e["message"]
        h = c.get("/health").json()
        assert h["assets"] == {"face_landmarker": False, "gesture_recognizer": False}
        with c.websocket_connect(f"/ws/sessions/{sid}/vision") as ws:
            ws.send_bytes(png())
            assert ws.receive_json()["error"]["code"] == "not_configured"


def test_m4_t15_session_delete_closes_backends(client, app, sid, backend):
    post(client, sid)
    assert app.state.vision.has(sid) and backend.closed is False
    assert client.delete(f"/sessions/{sid}").status_code == 204
    assert backend.closed is True
    assert not app.state.vision.has(sid)
    assert client.get(f"/sessions/{sid}/vision/cues").status_code == 404


# ---------------------------------------------------------------- converters / merger
def _cat(name, score):
    return SimpleNamespace(category_name=name, score=score)


def test_m4_face_result_conversion():
    ang = math.radians(10)
    rot = np.eye(4)
    rot[1][1], rot[1][2], rot[2][1], rot[2][2] = math.cos(ang), -math.sin(ang), math.sin(ang), math.cos(ang)
    res = SimpleNamespace(
        face_landmarks=[[1]],
        face_blendshapes=[[_cat("jawOpen", 0.5), _cat("eyeBlinkLeft", 0.9), _cat("mouthClose", 0.1)]],
        facial_transformation_matrixes=[rot],
    )
    f = face_obs_from_result(res)
    assert f.mouth == {"jawOpen": 0.5, "mouthClose": 0.1}  # only mouth features are kept
    assert f.pitch_deg == pytest.approx(10.0)
    assert face_obs_from_result(SimpleNamespace(face_landmarks=[], face_blendshapes=[], facial_transformation_matrixes=[])) is None


def test_m4_gesture_result_conversion():
    res = SimpleNamespace(gestures=[[_cat("Thumb_Up", 0.93)]], handedness=[[_cat("Left", 0.99)]])
    assert gesture_obs_from_result(res) == GestureObs("Thumb_Up", 0.93, "Left")
    assert gesture_obs_from_result(SimpleNamespace(gestures=[], handedness=[])) is None


def test_m4_live_merger_joins_and_newest_wins():
    m = LiveMerger()
    m.store(10, "face", "F10")
    assert m.take() is None  # gesture half missing
    m.store(10, "gesture", None)
    m.store(20, "gesture", "G20")
    m.store(20, "face", "F20")
    got = m.take()
    assert (got.timestamp_ms, got.face, got.gesture) == (20, "F20", "G20")
    assert m.take() is None
    m.store(15, "face", "x")  # late half of an older frame never resurrects it
    m.store(15, "gesture", "y")
    assert m.take().timestamp_ms == 15  # not newer than anything already consumed -> still delivered once
    for i in range(100):
        m.store(1000 + i, "face", None)  # unmatched halves are bounded
    assert len(m._partial) <= 32


# ---------------------------------------------------------------- real models (skipped when absent)
_have_models = (ASSETS / "face_landmarker.task").is_file() and (ASSETS / "gesture_recognizer.task").is_file()


@pytest.mark.skipif(not _have_models, reason="MediaPipe .task files not in assets/ (see README); real-model test skipped")
def test_m4_real_models_blank_image_detects_nothing():
    from services.vision import MediaPipeBackend

    b = MediaPipeBackend(ASSETS / "face_landmarker.task", ASSETS / "gesture_recognizer.task", "image")
    try:
        o = b.analyze(np.zeros((240, 320, 3), np.uint8), 5)
        assert o.face is None and (o.gesture is None or o.gesture.label == "None" or o.gesture.score < 0.6)
    finally:
        b.close()
