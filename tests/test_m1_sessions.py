import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from clock import FakeClock
from main import create_app
from services.consent import require_consent

FLAGS = ("audio_recording", "face_capture", "voice_cloning", "demo_use")


@pytest.fixture
def fclock():
    return FakeClock(5000)


@pytest.fixture
def app(settings, fclock):
    app = create_app(settings, clock=fclock)

    for purpose in FLAGS:
        def make(p):
            @app.get(f"/_probe/{{session_id}}/{p}")
            async def probe(session=Depends(require_consent(p))):
                return {"ok": True, "session_id": session.session_id}
        make(purpose)
    return app


def test_m1_t01_roundtrip_and_defaults(client):
    r = client.post("/sessions")
    assert r.status_code == 201
    b = r.json()
    assert b["language"] == "en" and b["voice_mode"] == "none"
    sid = b["session_id"]
    assert client.get(f"/sessions/{sid}").json()["session_id"] == sid
    r = client.post("/sessions", json={"language": "hi", "voice_mode": "designed"})
    assert (r.json()["language"], r.json()["voice_mode"]) == ("hi", "designed")
    assert client.delete(f"/sessions/{sid}").status_code == 204
    assert client.get(f"/sessions/{sid}").status_code == 404


def test_m1_t02_consent_defaults_false(client):
    c = client.post("/sessions").json()["consent"]
    assert all(c[f] is False for f in FLAGS)
    assert c["recorded_ms"] is None and c["recorded_at"] is None


def test_m1_t03_consent_persists_timestamped_and_replaces(client, fclock):
    sid = client.post("/sessions").json()["session_id"]
    fclock.advance(1200)
    c = client.post(f"/sessions/{sid}/consent", json={"audio_recording": True, "face_capture": True}).json()["consent"]
    assert c["audio_recording"] and c["face_capture"] and not c["voice_cloning"] and not c["demo_use"]
    assert c["recorded_ms"] == 1200 and c["recorded_at"]
    assert client.get(f"/sessions/{sid}").json()["consent"] == c
    fclock.advance(300)
    c2 = client.post(f"/sessions/{sid}/consent", json={"demo_use": True}).json()["consent"]
    assert c2["demo_use"] is True and c2["audio_recording"] is False and c2["face_capture"] is False
    assert c2["recorded_ms"] == 1500


@pytest.mark.parametrize("purpose", FLAGS)
def test_m1_t04_require_consent(client, purpose):
    sid = client.post("/sessions").json()["session_id"]
    r = client.get(f"/_probe/{sid}/{purpose}")
    assert r.status_code == 403
    e = r.json()["error"]
    assert e["code"] == "consent_required" and purpose in e["message"] and e["details"] == {"purpose": purpose}
    client.post(f"/sessions/{sid}/consent", json={purpose: True})
    r = client.get(f"/_probe/{sid}/{purpose}")
    assert r.status_code == 200 and r.json()["session_id"] == sid
    # consenting to one purpose does not grant the others
    for other in FLAGS:
        if other != purpose:
            assert client.get(f"/_probe/{sid}/{other}").status_code == 403


def test_m1_t05_delete_removes_and_runs_cleanup(client, app):
    seen = []
    app.state.sessions.register_cleanup(lambda s: seen.append(s.session_id))
    app.state.sessions.register_cleanup(lambda s: 1 / 0)  # failing hook must not block deletion
    sid = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{sid}/consent", json={"face_capture": True})
    assert client.delete(f"/sessions/{sid}").status_code == 204
    assert seen == [sid]
    assert client.get(f"/sessions/{sid}").status_code == 404
    assert client.get(f"/_probe/{sid}/face_capture").status_code == 404
    assert client.delete(f"/sessions/{sid}").status_code == 404
    assert seen == [sid]


def test_m1_t06_unknown_session_404_shape(client):
    for method, path in [("get", "/sessions/nope"), ("delete", "/sessions/nope")]:
        r = getattr(client, method)(path)
        assert r.status_code == 404
        e = r.json()["error"]
        assert e["code"] == "not_found" and e["request_id"]
    assert client.post("/sessions/nope/consent", json={}).status_code == 404


def test_m1_t07_invalid_values_422(client):
    for body in ({"language": "fr"}, {"voice_mode": "robot"}, {"bogus": 1}):
        r = client.post("/sessions", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    sid = client.post("/sessions").json()["session_id"]
    assert client.post(f"/sessions/{sid}/consent", json={"face_capture": "maybe"}).status_code == 422


def test_m1_t08_sessions_isolated(client):
    a = client.post("/sessions").json()["session_id"]
    b = client.post("/sessions").json()["session_id"]
    assert a != b
    client.post(f"/sessions/{a}/consent", json={"face_capture": True})
    assert client.get(f"/_probe/{a}/face_capture").status_code == 200
    assert client.get(f"/_probe/{b}/face_capture").status_code == 403
    assert client.get(f"/sessions/{b}").json()["consent"]["face_capture"] is False


def test_m1_session_clock_starts_at_zero(app, fclock):
    s = app.state.sessions.create()
    assert s.clock.now_ms() == 0
    fclock.advance(40)
    assert s.clock.now_ms() == 40
