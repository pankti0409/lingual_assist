import logging
import socket

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from clock import FakeClock, Timer
from config import SettingsError, load_settings
from main import create_app


def test_m0_t01_health_schema(client):
    r = client.get("/health")
    assert r.status_code == 200
    b = r.json()
    assert b["status"] == "ok"
    assert b["python"].startswith("3.")
    assert set(b["services"]) == {"elevenlabs", "groq"}
    assert b["models"] == {
        "llm": "openai/gpt-oss-120b",
        "tts": "eleven_flash_v2_5",
        "scribe_batch": "scribe_v2",
        "scribe_realtime": "scribe_v2_realtime",
    }
    assert set(b["assets"]) == {"face_landmarker", "gesture_recognizer"}


def test_m0_t02_no_key_leak(caplog):
    s = load_settings(
        {"ELEVENLABS_API_KEY": "sk-secret-eleven-123", "GROQ_API_KEY": "gsk-secret-groq-456"},
        use_dotenv=False,
    )
    with caplog.at_level(logging.DEBUG):
        with TestClient(create_app(s)) as c:
            r = c.get("/health")
            c.get("/nope")
    assert r.json()["services"] == {"elevenlabs": True, "groq": True}
    blob = r.text + caplog.text + repr(s) + str(s)
    for secret in ("sk-secret-eleven-123", "gsk-secret-groq-456", "sk-secret", "gsk-secret"):
        assert secret not in blob


def test_m0_t03_missing_keys(client):
    b = client.get("/health").json()
    assert b["services"] == {"elevenlabs": False, "groq": False}


def test_m0_t04_settings_from_env_and_invalid():
    s = load_settings({"CUE_MAX_AGE_MS": "900", "LLM_TEMPERATURE": "0.5", "LLM_MODEL": "x/y"}, use_dotenv=False)
    assert s.cue_max_age_ms == 900 and s.llm_temperature == 0.5 and s.llm_model == "x/y"
    assert load_settings({}, use_dotenv=False).cue_max_age_ms == 1500
    with pytest.raises(SettingsError, match="MAX_AUDIO_BYTES"):
        load_settings({"MAX_AUDIO_BYTES": "lots"}, use_dotenv=False)
    with pytest.raises(SettingsError, match="HISTORY_WINDOW_TURNS"):
        load_settings({"HISTORY_WINDOW_TURNS": "9"}, use_dotenv=False)


def test_m0_t05_unknown_route_404(client):
    r = client.get("/does-not-exist", headers={"X-Request-ID": "abc-123"})
    assert r.status_code == 404
    e = r.json()["error"]
    assert e["code"] == "not_found" and e["request_id"] == "abc-123" and e["details"] is None
    assert e["message"]


def test_m0_t06_validation_error_shape(settings):
    class Body(BaseModel):
        n: int

    app = create_app(settings)

    @app.post("/_probe")
    async def probe(b: Body):
        return b

    with TestClient(app) as c:
        r = c.post("/_probe", json={"n": "not-an-int"})
    assert r.status_code == 422
    e = r.json()["error"]
    assert e["code"] == "validation_error" and e["request_id"]
    assert "detail" not in r.json()
    assert e["details"][0]["loc"][-1] == "n"


def test_m0_t06b_unhandled_exception_shape(settings):
    app = create_app(settings)

    @app.get("/_boom")
    async def boom():
        raise RuntimeError("secret internals")

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/_boom")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal_error"
    assert "secret internals" not in r.text


def test_m0_t07_request_id(client):
    assert client.get("/health", headers={"X-Request-ID": "my-id-1"}).headers["x-request-id"] == "my-id-1"
    gen = client.get("/health").headers["x-request-id"]
    assert len(gen) >= 16
    assert client.get("/health").headers["x-request-id"] != gen
    bad = client.get("/health", headers={"X-Request-ID": "bad id with spaces!"}).headers["x-request-id"]
    assert bad != "bad id with spaces!"


def test_m0_t08_network_blocked():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(RuntimeError, match="Network access blocked"):
            s.connect(("8.8.8.8", 53))
    finally:
        s.close()


def test_m0_t09_fake_clock_and_timer():
    clock = FakeClock(100)
    t = Timer(clock)
    assert clock.now_ms() == 100 and t.elapsed_ms() == 0
    clock.advance(250)
    assert t.elapsed_ms() == 250
    t.reset()
    clock.advance(5)
    assert t.elapsed_ms() == 5
    with pytest.raises(ValueError):
        clock.advance(-1)
