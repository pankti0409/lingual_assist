import json

import pytest

from main import create_app
from services.fusion import Completion, LLMIntentRanker, get_ranker

WATER = {
    "intent": "request_water",
    "candidate_replies": ["I would like water, please.", "Could I have some water?"],
    "clarification_required": False,
    "reasoning_summary": "Transcript and recent question align.",
}
UNCLEAR = {
    "intent": "unclear",
    "candidate_replies": [],
    "clarification_required": True,
    "reasoning_summary": "Evidence conflicts.",
}


class FakeLLM:
    def __init__(self):
        self.next = WATER
        self.calls = 0

    async def complete(self, messages):
        self.calls += 1
        return Completion(json.dumps(self.next))


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def app(settings, llm):
    app = create_app(settings)
    app.dependency_overrides[get_ranker] = lambda: LLMIntentRanker(llm)
    return app


@pytest.fixture
def sid(client):
    s = client.post("/sessions").json()["session_id"]
    client.post(f"/sessions/{s}/turns/text", json={"speaker": "partner", "text": "Water or tea?"})
    client.post(f"/sessions/{s}/turns/text", json={"speaker": "patient", "text": "wa... water"})
    return s


def fuse(client, sid, **body):
    r = client.post(f"/sessions/{sid}/fuse", json=body)
    assert r.status_code == 200, r.text
    return r.json()["proposal"]


def act(client, sid, pid, action, **body):
    return client.post(f"/sessions/{sid}/proposals/{pid}/{action}", json=body or None)


def confirmed_ids(app, sid):
    return [m.confirmed_id for m in app.state.proposals.list_confirmed(sid)]


def test_m7_t01_confirm_issues_id_with_exact_candidate_text(client, sid, app):
    p = fuse(client, sid)
    assert p["state"] == "pending"
    r = act(client, sid, p["proposal_id"], "confirm", candidate_index=1)
    assert r.status_code == 200
    b = r.json()
    assert b["proposal"]["state"] == "confirmed"
    c = b["confirmed"]
    assert c["text"] == WATER["candidate_replies"][1] == "Could I have some water?"
    assert (c["how"], c["candidate_index"], c["proposal_id"]) == ("candidate", 1, p["proposal_id"])
    assert len(c["confirmed_id"]) == 32
    got = client.get(f"/sessions/{sid}/confirmed/{c['confirmed_id']}")
    assert got.status_code == 200 and got.json() == c


def test_m7_t02_edit_stores_exact_text(client, sid):
    for text in ("मुझे पानी चाहिए, कृपया...", "  I'd like tea?!  "):
        p = fuse(client, sid)
        r = act(client, sid, p["proposal_id"], "edit", text=text)
        assert r.status_code == 200
        b = r.json()
        assert b["proposal"]["state"] == "edited_confirmed"
        assert b["confirmed"]["text"] == text.strip() and b["confirmed"]["how"] == "edited"
        assert b["confirmed"]["candidate_index"] is None
    p = fuse(client, sid)
    for bad in ("", "   \n", "x" * 301):
        r = act(client, sid, p["proposal_id"], "edit", text=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert act(client, sid, p["proposal_id"], "edit", text="x" * 300).status_code == 200
    p2 = fuse(client, sid)
    assert act(client, sid, p2["proposal_id"], "edit", text="a", extra=1).status_code == 422


def test_m7_t03_reject_never_issues_id(client, sid, app):
    p = fuse(client, sid)
    r = act(client, sid, p["proposal_id"], "reject")
    assert r.status_code == 200
    b = r.json()
    assert b["proposal"]["state"] == "rejected" and b["confirmed"] is None and b["re_fuse_available"] is True
    assert confirmed_ids(app, sid) == []
    assert act(client, sid, p["proposal_id"], "confirm", candidate_index=0).status_code == 409
    assert act(client, sid, p["proposal_id"], "edit", text="sneaky").status_code == 409
    assert confirmed_ids(app, sid) == []


def test_m7_t04_clarify(client, sid, app):
    p = fuse(client, sid)
    r = act(client, sid, p["proposal_id"], "clarify")
    assert r.status_code == 200
    assert r.json()["proposal"]["state"] == "clarification_requested" and r.json()["confirmed"] is None
    assert confirmed_ids(app, sid) == []
    assert act(client, sid, p["proposal_id"], "confirm", candidate_index=0).status_code == 409


def test_m7_t05_unknown_and_foreign_proposal_404(client, sid):
    p = fuse(client, sid)
    other = client.post("/sessions").json()["session_id"]
    for action, body in (("confirm", {"candidate_index": 0}), ("edit", {"text": "x"}), ("reject", {}), ("clarify", {})):
        assert act(client, sid, "deadbeef", action, **body).status_code == 404
        r = act(client, other, p["proposal_id"], action, **body)  # proposal belongs to another session
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert act(client, "nope", p["proposal_id"], "reject").status_code == 404
    # the untouched proposal is still pending
    assert act(client, sid, p["proposal_id"], "confirm", candidate_index=0).status_code == 200


def test_m7_t06_candidate_index_out_of_range_422(client, sid, app):
    p = fuse(client, sid)
    for idx in (2, 99):
        r = act(client, sid, p["proposal_id"], "confirm", candidate_index=idx)
        assert r.status_code == 422, idx
    for bad in (-1, "0", 1.5, True, None):
        assert act(client, sid, p["proposal_id"], "confirm", candidate_index=bad).status_code == 422, bad
    assert client.post(f"/sessions/{sid}/proposals/{p['proposal_id']}/confirm", json={}).status_code == 422
    assert confirmed_ids(app, sid) == []
    assert app.state.proposals.get(sid, p["proposal_id"]).state == "pending"


def test_m7_t07_idempotent_repeat_and_conflicts(client, sid, app):
    p = fuse(client, sid)
    a = act(client, sid, p["proposal_id"], "confirm", candidate_index=0).json()
    b = act(client, sid, p["proposal_id"], "confirm", candidate_index=0).json()
    assert a["confirmed"]["confirmed_id"] == b["confirmed"]["confirmed_id"]
    assert a["effort_actions"] == b["effort_actions"] == 1  # repeat is not new effort
    assert len(confirmed_ids(app, sid)) == 1
    for action, body in (
        ("confirm", {"candidate_index": 1}),
        ("edit", {"text": "other"}),
        ("reject", {}),
        ("clarify", {}),
    ):
        r = act(client, sid, p["proposal_id"], action, **body)
        assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state", action
    assert len(confirmed_ids(app, sid)) == 1
    # edit idempotency
    q = fuse(client, sid)
    e1 = act(client, sid, q["proposal_id"], "edit", text="Tea please").json()
    e2 = act(client, sid, q["proposal_id"], "edit", text="  Tea please ").json()
    assert e1["confirmed"]["confirmed_id"] == e2["confirmed"]["confirmed_id"]
    assert act(client, sid, q["proposal_id"], "edit", text="Coffee").status_code == 409
    assert act(client, sid, q["proposal_id"], "confirm", candidate_index=0).status_code == 409
    # reject / clarify repeats are idempotent too
    r1 = fuse(client, sid)
    assert act(client, sid, r1["proposal_id"], "reject").status_code == 200
    assert act(client, sid, r1["proposal_id"], "reject").status_code == 200
    assert act(client, sid, r1["proposal_id"], "clarify").status_code == 409
    c1 = fuse(client, sid)
    assert act(client, sid, c1["proposal_id"], "clarify").status_code == 200
    assert act(client, sid, c1["proposal_id"], "clarify").status_code == 200
    assert act(client, sid, c1["proposal_id"], "reject").status_code == 409


def test_m7_t08_effort_counter_accumulates_across_refuse_chain(client, sid):
    p1 = fuse(client, sid)
    assert act(client, sid, p1["proposal_id"], "reject").json()["effort_actions"] == 1
    p2 = fuse(client, sid)  # re-fuse the same patient turn: same chain
    assert act(client, sid, p2["proposal_id"], "clarify").json()["effort_actions"] == 2
    p3 = fuse(client, sid)
    r = act(client, sid, p3["proposal_id"], "confirm", candidate_index=0).json()
    assert r["effort_actions"] == 3 and r["confirmed"]["effort_actions"] == 3
    # a fresh patient turn starts a new chain
    client.post(f"/sessions/{sid}/turns/text", json={"speaker": "patient", "text": "tea"})
    p4 = fuse(client, sid)
    assert act(client, sid, p4["proposal_id"], "edit", text="Tea").json()["confirmed"]["effort_actions"] == 1
    # after a confirm the chain is closed: re-fusing the same turn later starts again at 1
    p5 = fuse(client, sid)
    assert act(client, sid, p5["proposal_id"], "reject").json()["effort_actions"] == 1


def test_m7_t09_nothing_speakable_before_confirmation(client, sid, app):
    pending = fuse(client, sid)
    rejected = fuse(client, sid)
    clarified = fuse(client, sid)
    act(client, sid, rejected["proposal_id"], "reject")
    act(client, sid, clarified["proposal_id"], "clarify")
    assert confirmed_ids(app, sid) == []  # no id exists for pending / rejected / clarified
    assert app.state.proposals.get(sid, pending["proposal_id"]).state == "pending"
    for p in (pending, rejected, clarified):
        # neither proposal ids nor made-up ids resolve to a speakable message
        for guess in (p["proposal_id"], "0" * 32, "deadbeef", p["turn_id"]):
            r = client.get(f"/sessions/{sid}/confirmed/{guess}")
            assert r.status_code == 404, guess
    for p in (rejected, clarified):
        for action, body in (("confirm", {"candidate_index": 0}), ("edit", {"text": "speak this"})):
            r = act(client, sid, p["proposal_id"], action, **body)
            assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state"
    assert confirmed_ids(app, sid) == []
    # fusing alone (even many times) never creates one
    for _ in range(3):
        fuse(client, sid)
    assert confirmed_ids(app, sid) == []
    # a confirmed id from one session does not resolve in another
    ok = act(client, sid, pending["proposal_id"], "confirm", candidate_index=0).json()["confirmed"]["confirmed_id"]
    other = client.post("/sessions").json()["session_id"]
    assert client.get(f"/sessions/{other}/confirmed/{ok}").status_code == 404
    assert client.get(f"/sessions/{sid}/confirmed/{ok}").status_code == 200


def test_m7_t10_clarification_proposal_without_candidates(client, sid, llm, app):
    llm.next = UNCLEAR
    p = fuse(client, sid)
    assert p["fusion"]["candidate_replies"] == [] and p["state"] == "pending"
    r = act(client, sid, p["proposal_id"], "confirm", candidate_index=0)
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_state"
    assert confirmed_ids(app, sid) == []
    # the patient can still author their own words
    assert act(client, sid, p["proposal_id"], "edit", text="Water, please").status_code == 200


def test_m7_clarification_proposal_with_candidates_can_be_confirmed(client, sid, llm):
    llm.next = {**UNCLEAR, "candidate_replies": ["Water?", "Tea?"]}
    p = fuse(client, sid)
    r = act(client, sid, p["proposal_id"], "confirm", candidate_index=0)
    assert r.status_code == 200 and r.json()["confirmed"]["text"] == "Water?"


def test_m7_cleanup_on_session_delete(client, sid, app):
    p = fuse(client, sid)
    cid = act(client, sid, p["proposal_id"], "confirm", candidate_index=0).json()["confirmed"]["confirmed_id"]
    client.delete(f"/sessions/{sid}")
    assert app.state.proposals.get(sid, p["proposal_id"]) is None
    assert app.state.proposals.get_confirmed(sid, cid) is None
    assert client.get(f"/sessions/{sid}/confirmed/{cid}").status_code == 404
