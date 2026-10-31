import pytest

from clock import FakeClock
from config import SettingsError, load_settings
from main import create_app
from state.conversation import ConversationState


@pytest.fixture
def fclock():
    return FakeClock()


@pytest.fixture
def app(settings, fclock):
    return create_app(settings, clock=fclock)


def _sid(client):
    return client.post("/sessions").json()["session_id"]


def _say(client, sid, speaker, text, **kw):
    return client.post(f"/sessions/{sid}/turns/text", json={"speaker": speaker, "text": text, **kw})


def test_m2_t01_speaker_labels_preserved(client):
    sid = _sid(client)
    for sp, tx in [("partner", "Water or tea?"), ("patient", "wa... water"), ("partner", "Okay, water.")]:
        assert _say(client, sid, sp, tx).status_code == 201
    turns = client.get(f"/sessions/{sid}/history").json()["turns"]
    assert [(t["speaker"], t["text"]) for t in turns] == [
        ("partner", "Water or tea?"),
        ("patient", "wa... water"),
        ("partner", "Okay, water."),
    ]
    assert all(t["source"] == "typed" for t in turns)


def test_m2_t02_window_trims_in_order(fclock):
    c = ConversationState(fclock, window=4)
    for i in range(9):
        c.add_turn("patient" if i % 2 else "partner", f"t{i}", "en", "typed")
    assert [t.text for t in c.recent()] == ["t5", "t6", "t7", "t8"]
    assert [t.text for t in c.recent(2)] == ["t7", "t8"]
    assert [t.text for t in c.recent(50)] == [f"t{i}" for i in range(9)]
    assert c.recent(0) == []


def test_m2_t02b_http_default_window_and_limit(client):
    sid = _sid(client)
    for i in range(10):
        _say(client, sid, "partner", f"t{i}")
    assert [t["text"] for t in client.get(f"/sessions/{sid}/history").json()["turns"]] == [f"t{i}" for i in range(4, 10)]
    assert [t["text"] for t in client.get(f"/sessions/{sid}/history?limit=2").json()["turns"]] == ["t8", "t9"]
    assert client.get(f"/sessions/{sid}/history?limit=0").status_code == 422


def test_m2_t03_timestamps_non_decreasing(client, fclock):
    sid = _sid(client)
    stamps = []
    for step in (0, 250, 0, 1000):
        fclock.advance(step)
        stamps.append(_say(client, sid, "partner", "x").json()["timestamp_ms"])
    assert stamps == [0, 250, 250, 1250]
    assert stamps == sorted(stamps)


def test_m2_t04_empty_history_renders_empty(fclock, client):
    assert ConversationState(fclock).render_context() == []
    assert client.get(f"/sessions/{_sid(client)}/history").json() == {"turns": []}


def test_m2_t05_render_context_shape(fclock):
    c = ConversationState(fclock)
    c.add_turn("partner", "Water or tea?", "en", "typed")
    assert c.render_context() == [{"speaker": "partner", "text": "Water or tea?"}]
    assert list(c.render_context()[0].keys()) == ["speaker", "text"]


def test_m2_t06_exclude_current_turn(fclock):
    c = ConversationState(fclock, window=4)
    for i in range(5):
        c.add_turn("partner", f"p{i}", "en", "typed")
    cur = c.add_turn("patient", "wa... water", "en", "scribe_batch")
    ctx = c.render_context(exclude_turn_id=cur.turn_id)
    assert "wa... water" not in [x["text"] for x in ctx]
    assert [x["text"] for x in ctx] == ["p1", "p2", "p3", "p4"]  # still a full window
    assert len(c.render_context()) == 4 and c.render_context()[-1]["text"] == "wa... water"


def test_m2_t07_window_outside_4_6_is_config_error(fclock):
    for bad in (3, 7, 0):
        with pytest.raises(ValueError):
            ConversationState(fclock, window=bad)
    for ok in (4, 5, 6):
        assert ConversationState(fclock, window=ok).window == ok
    with pytest.raises(SettingsError, match="HISTORY_WINDOW_TURNS"):
        load_settings({"HISTORY_WINDOW_TURNS": "3"}, use_dotenv=False)


def test_m2_t08_invalid_turn_input_422(client):
    sid = _sid(client)
    for body in (
        {"speaker": "partner", "text": ""},
        {"speaker": "partner", "text": "   \n\t"},
        {"speaker": "nurse", "text": "hello"},
        {"speaker": "partner", "text": "hi", "language": "fr"},
        {"speaker": "partner", "text": "x" * 1001},
        {"text": "no speaker"},
    ):
        r = client.post(f"/sessions/{sid}/turns/text", json=body)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] == "validation_error"
    assert client.get(f"/sessions/{sid}/history").json()["turns"] == []


def test_m2_t09_sessions_isolated(client):
    a, b = _sid(client), _sid(client)
    _say(client, a, "partner", "only in A")
    assert client.get(f"/sessions/{b}/history").json()["turns"] == []
    assert [t["text"] for t in client.get(f"/sessions/{a}/history").json()["turns"]] == ["only in A"]


def test_m2_language_default_and_override(client):
    sid = client.post("/sessions", json={"language": "hi"}).json()["session_id"]
    assert _say(client, sid, "patient", "paani").json()["language"] == "hi"
    assert _say(client, sid, "patient", "water", language="en").json()["language"] == "en"
    assert _say(client, sid, "patient", "stripped  ").json()["text"] == "stripped"


def test_m2_unknown_session_404(client):
    assert client.get("/sessions/nope/history").status_code == 404
    assert _say(client, "nope", "partner", "hi").status_code == 404


def test_m2_delete_clears_history(client, app):
    sid = _sid(client)
    _say(client, sid, "partner", "hi")
    session = app.state.sessions.get(sid)
    client.delete(f"/sessions/{sid}")
    assert session.conversation.recent() == []
    assert client.get(f"/sessions/{sid}/history").status_code == 404
