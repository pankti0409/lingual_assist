import csv
import io
import json
import unicodedata
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from config import load_settings
from errors import AppError
from evaluation import metrics as M
from evaluation.mock import MockChatLLM, MockSynth
from evaluation.runner import EvalDeps, EvalDepsFactory, get_eval_deps_factory, run_eval
from evaluation.schema import MIN_PER_GROUP, Scenario, ScenarioSet, group_counts, load_scenarios
from main import create_app
from routers import eval as eval_router
from services.fusion import LLMIntentRanker
from services.scribe import BatchResult

SCENARIOS = Path(__file__).resolve().parent.parent / "evaluation" / "scenarios.json"


# ------------------------------------------------------------------ WER
def test_m10_t01_wer_hand_computed():
    r = M.wer("the cat sat", "the cat sat")
    assert (r.wer, r.substitutions, r.deletions, r.insertions, r.ref_words) == (0.0, 0, 0, 0, 3)
    r = M.wer("the cat sat", "the dog sat")  # 1 substitution / 3 words
    assert (r.substitutions, r.deletions, r.insertions) == (1, 0, 0) and r.wer == pytest.approx(100 / 3)
    r = M.wer("the cat sat", "the sat")  # 1 deletion
    assert (r.substitutions, r.deletions, r.insertions) == (0, 1, 0) and r.wer == pytest.approx(100 / 3)
    r = M.wer("the cat sat", "the big cat sat")  # 1 insertion
    assert (r.substitutions, r.deletions, r.insertions) == (0, 0, 1) and r.wer == pytest.approx(100 / 3)
    r = M.wer("a b c d", "a x c")  # b->x substitution, d deleted: (1+1)/4
    assert (r.substitutions, r.deletions, r.insertions) == (1, 1, 0) and r.wer == 50.0
    r = M.wer("a b", "x y z w")  # 2 substitutions + 2 insertions over 2 words = 200 % (WER can exceed 100)
    assert r.wer == 200.0 and (r.substitutions, r.insertions) == (2, 2)
    assert M.wer("The Cat", "the cat").wer == 0.0  # mixed case
    r = M.wer("मुझे पानी चाहिए", "मुझे चाय चाहिए")  # Devanagari tokens
    assert r.substitutions == 1 and r.wer == pytest.approx(100 / 3) and r.ref_words == 3
    r = M.wer("मुझे पानी चाहिए।", "मुझे पानी चाहिए")  # danda is punctuation
    assert r.wer == 0.0


def test_m10_t01b_empty_reference_defined_behaviour():
    both = M.wer("", "")
    assert both.wer == 0.0 and both.note
    r = M.wer("", "krrr shh")
    assert r.wer is None and r.insertions == 2 and "undefined" in r.note
    assert M.wer("  ...  ", "").wer == 0.0  # punctuation-only reference counts as empty
    assert M.wer("hello", "").wer == 100.0  # all deleted, no crash


def test_m10_t02_normalisation_applies_equally():
    assert M.normalize_text("Hello,  WORLD!!") == "hello world"
    assert M.wer("Hello, World!", "hello world").wer == 0.0
    assert M.wer("hello world", "Hello, World!").wer == 0.0  # symmetric
    assert M.wer("wa... water", "wa water").wer == 0.0
    composed, decomposed = "café", unicodedata.normalize("NFD", "café")
    assert composed != decomposed and M.wer(composed, decomposed).wer == 0.0  # NFC
    assert M.tokenize("  ") == [] and M.tokenize("a   b\tc") == ["a", "b", "c"]
    # combining marks (Devanagari vowel signs) are not stripped as punctuation
    assert M.normalize_text("पानी") == "पानी"


def test_m10_aggregate_wer_is_micro_average_and_counts_undefined():
    a, b, c = M.wer("a b c d", "a b c d"), M.wer("x y", "z z"), M.wer("", "oops")
    agg = M.aggregate_wer([a, b, c])
    assert agg["ref_words"] == 6 and agg["wer"] == pytest.approx(2 / 6 * 100)
    assert (agg["n"], agg["n_undefined"]) == (2, 1)
    assert M.aggregate_wer([])["wer"] is None


# ------------------------------------------------------------------ intent accuracy
def _rec(group, lang, correct):
    return {"group": group, "language": lang, "correct": correct}


def test_m10_t03_intent_accuracy_rules():
    ok = M.is_correct
    assert ok("clear", "request_water", False, "request_water", [], False)
    assert ok("clear", " Request-Water ", False, "request_water", [], False)  # normalised
    assert ok("gesture", "decline_no", False, "decline_tea", ["decline_no"], False)  # alias
    assert not ok("clear", "request_tea", False, "request_water", ["request_drink"], False)
    assert not ok("clear", None, None, "request_water", [], False)
    # negative cases: only clarification_required vs expected_clarification matters
    assert ok("negative", "whatever", True, "unclear", [], True)
    assert not ok("negative", "request_water", False, "unclear", [], True)
    assert ok("negative", "request_water", False, "unclear", [], False)
    assert not ok("negative", "unclear", True, "unclear", [], False)


def test_m10_t03b_accuracy_arithmetic_overall_and_per_language():
    recs = [_rec("clear", "en", True), _rec("clear", "en", False), _rec("language", "hi", True),
            _rec("language", "hi", True), _rec("language", "mixed", False)]
    assert M.accuracy([r["correct"] for r in recs]) == {"accuracy": 60.0, "correct": 3, "n": 5}
    by = M.accuracy_by(recs, "language")
    assert by["en"] == {"accuracy": 50.0, "correct": 1, "n": 2}
    assert by["hi"]["accuracy"] == 100.0 and by["mixed"]["accuracy"] == 0.0
    assert M.accuracy([]) == {"accuracy": None, "correct": 0, "n": 0}  # no data is not 0 %


# ------------------------------------------------------------------ latency / effort
def test_m10_t04_percentiles_nearest_rank_and_low_sample_flag():
    assert M.percentile([15, 20, 35, 40, 50], 50) == 35  # rank ceil(2.5)=3
    assert M.percentile([15, 20, 35, 40, 50], 95) == 50  # rank ceil(4.75)=5
    assert M.percentile([50, 15, 40, 20, 35], 50) == 35  # order-independent
    hundred = list(range(1, 101))
    assert (M.percentile(hundred, 50), M.percentile(hundred, 95), M.percentile(hundred, 100)) == (50, 95, 100)
    assert M.percentile([7], 95) == 7 and M.percentile([], 50) is None
    s = M.latency_summary(list(range(1, 20)))
    assert s["n"] == 19 and s["p95_low_sample"] is True and s["method"] == "nearest-rank"
    s = M.latency_summary(list(range(1, 21)))
    assert s["n"] == 20 and s["p95_low_sample"] is False and s["p95"] == 19 and s["p50"] == 10
    assert M.latency_summary([])["p50"] is None


def test_m10_stage_breakdown():
    recs = [{"scribe_ms": 300, "fusion_ms": 200, "tts_first_audio_ms": 90, "system_latency_ms": 310},
            {"scribe_ms": None, "fusion_ms": 100, "tts_first_audio_ms": 50, "system_latency_ms": None}]
    b = M.stage_breakdown(recs)
    assert b["scribe_ms"]["n"] == 1 and b["fusion_ms"]["n"] == 2
    assert b["other_ms"]["n"] == 1 and b["other_ms"]["p50"] == 20  # 310 - 200 - 90


def test_m10_t05_effort_mean_excludes_unconfirmed():
    recs = [
        {"communicated": True, "effort_actions": 1},
        {"communicated": True, "effort_actions": 3},
        {"communicated": False, "effort_actions": 5},  # clarified/rejected, never communicated
        {"communicated": True, "effort_actions": None},
    ]
    assert M.mean_effort(recs) == {"mean_actions": 2.0, "n": 2}
    assert M.mean_effort([{"communicated": False, "effort_actions": 2}]) == {"mean_actions": None, "n": 0}


# ------------------------------------------------------------------ scenarios file
def test_m10_t09_scenarios_validate_and_cover_groups():
    s = load_scenarios(SCENARIOS)
    counts = group_counts(s.cases)
    for group, minimum in MIN_PER_GROUP.items():
        assert counts.get(group, 0) >= minimum, group
    langs = {c.language for c in s.cases if c.group == "language"}
    assert langs == {"en", "hi", "mixed"}
    atypical = [c for c in s.cases if c.group == "atypical"]
    assert len(atypical) == 5 and all(c.simulated for c in atypical)
    assert all(not c.simulated for c in s.cases if c.group != "atypical")
    assert len({c.id for c in s.cases}) == len(s.cases)
    assert all(c.patient_audio_path is None for c in s.cases)  # no fabricated recordings
    for c in s.cases:
        if c.group == "negative":
            assert c.expected_clarification is True
        assert c.expected_intent
    ids = {c.id for c in s.cases}
    assert {"negative-01-conflicting-cues", "negative-02-no-gesture", "negative-03-noise", "negative-04-no-speech"} <= ids


def test_m10_t09b_schema_rejects_bad_cases():
    good = json.loads(SCENARIOS.read_text(encoding="utf-8"))["cases"][0]
    Scenario.model_validate(good)
    with pytest.raises(ValidationError):
        Scenario.model_validate({**good, "bogus": 1})
    with pytest.raises(ValidationError):
        Scenario.model_validate({k: v for k, v in good.items() if k != "expected_intent"})
    with pytest.raises(ValidationError):
        Scenario.model_validate({**good, "group": "atypical", "simulated": False})
    with pytest.raises(ValidationError):
        Scenario.model_validate({**good, "language": "fr"})
    with pytest.raises(ValidationError):
        ScenarioSet.model_validate({"cases": [good, good]})


# ------------------------------------------------------------------ runner
class CapturingRanker:
    def __init__(self):
        self.inner = LLMIntentRanker(MockChatLLM())
        self.packets = []

    async def rank(self, packet):
        self.packets.append(packet)
        return await self.inner.rank(packet)


def one(case_id):
    s = load_scenarios(SCENARIOS)
    return ScenarioSet(cases=[c for c in s.cases if c.id == case_id])


@pytest.fixture
def settings():
    return load_settings({}, use_dotenv=False)


async def test_m10_t06_ablation_two_arms_same_cases_cues_only_in_B(settings):
    ranker = CapturingRanker()
    deps = EvalDeps(ranker, MockSynth(), "mock-voice")
    report = await run_eval(settings, one("gesture-01"), deps, "mock")
    a = [r for r in report["cases"] if r["arm"] == "A"]
    b = [r for r in report["cases"] if r["arm"] == "B"]
    assert [r["case_id"] for r in a] == [r["case_id"] for r in b] == ["gesture-01"]
    # arm A wrongly interprets, so the simulated patient rejects and re-fuses: two A packets, then one B packet
    a_packets, b_packets = ranker.packets[:-1], ranker.packets[-1:]
    assert len(a_packets) == 2 and len(b_packets) == 1
    assert all(p.visual_cues.gesture is None and p.visual_cues.mouth_activity is False for p in a_packets)
    g = b_packets[0].visual_cues
    assert g.gesture is not None and g.gesture.label == "Thumb_Up" and g.mouth_activity is True
    # same transcript and context in both arms
    assert {p.transcript for p in ranker.packets} == {"mm... that"}
    assert all(p.conversation_context == b_packets[0].conversation_context for p in a_packets)
    assert report["arms"]["A"]["n"] == report["arms"]["B"]["n"] == 1
    assert a[0]["correct"] is False and b[0]["correct"] is True  # mock rules: the cue resolves the ambiguity
    ab = report["ablation"]
    assert ab["intent_accuracy_overall"] == {"A": 0.0, "B": 100.0, "delta_B_minus_A": 100.0}
    assert ab["effort_overall"]["A"] > ab["effort_overall"]["B"]
    assert "WER" in ab["note"] and "no WER-improvement claim" in ab["note"].replace("No WER", "no WER")


async def test_m10_wer_is_identical_across_arms_and_scored_on_raw_text(settings):
    deps = EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), "v")
    report = await run_eval(settings, one("atypical-01"), deps, "mock")
    a, b = report["cases"]
    assert a["hypothesis"] == b["hypothesis"] == "wa... wa-er"  # raw, unmodified
    assert a["wer"] == b["wer"] == pytest.approx(M.wer("I would like some water", "wa... wa-er").wer)
    assert report["wer"]["overall"]["n"] == 1  # counted once, not once per arm


async def test_m10_t07_mock_report_labelled(settings):
    report = await run_eval(settings, load_scenarios(SCENARIOS), EvalDepsFactory().build("mock", settings), "mock")
    assert report["mode"] == "mock" and report["disclaimer"] == "mock results are not measurements"
    assert report["status"] == "ok" and report["n_cases"] == 30 and report["n_skipped"] == 0
    assert len(report["cases"]) == 60 and all(r["mode"] == "mock" for r in report["cases"])
    assert "generated_at" in report and "scripted" in report["cue_source"] and "Simulated patient" in report["patient_policy"]
    assert set(report["wer"]["by_language"]) == {"en", "hi", "mixed"}
    for lang in ("en", "hi", "mixed"):
        assert report["arms"]["B"]["intent_accuracy"]["by_language"][lang]["n"] > 0
    assert {"A", "B"} == set(report["arms"])


class FakeTranscriber:
    def __init__(self, text="I would like some water"):
        self.text, self.calls = text, []

    async def transcribe(self, audio, filename, content_type, language_code):
        self.calls.append((audio, filename, language_code))
        return BatchResult(self.text)

    async def open_realtime(self, *a):
        raise NotImplementedError


async def test_m10_t07b_live_mode_skips_cases_without_audio(settings, tmp_path):
    clip = tmp_path / "clip.wav"
    clip.write_bytes(b"RIFFfake")
    base = {c.id: c for c in load_scenarios(SCENARIOS).cases}
    with_audio = base["clear-01"].model_copy(update={"patient_audio_path": str(clip)})
    missing = base["clear-02"].model_copy(update={"patient_audio_path": str(tmp_path / "nope.wav")})
    no_audio = base["clear-03"]
    tr = FakeTranscriber("Yes, I would like some water please.")
    deps = EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), None, tr)
    report = await run_eval(settings, ScenarioSet(cases=[with_audio, missing, no_audio]), deps, "live")
    assert report["mode"] == "live" and "disclaimer" not in report
    assert report["n_cases"] == 3 and report["n_skipped"] == 2
    assert report["skipped_case_ids"] == ["clear-02", "clear-03"]
    assert "2 case(s) skipped" in report["note"]
    skipped = [r for r in report["cases"] if r["skipped"]]
    assert len(skipped) == 4 and all(r["skip_reason"] for r in skipped)
    assert any("not found" in r["skip_reason"] for r in skipped) and any("no patient_audio_path" in r["skip_reason"] for r in skipped)
    assert len(tr.calls) == 1 and tr.calls[0] == (b"RIFFfake", "clip.wav", "eng")  # audio read, language mapped
    done = [r for r in report["cases"] if not r["skipped"]]
    assert {r["case_id"] for r in done} == {"clear-01"} and all(isinstance(r["scribe_ms"], int) for r in done)
    assert report["arms"]["A"]["n"] == 1  # skipped cases are not counted as results
    assert report["tts_run"] is False and done[0]["system_latency_ms"] is None  # no voice: TTS leg not run, not faked


async def test_m10_live_mode_all_skipped_reports_no_numbers(settings):
    deps = EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), None, FakeTranscriber())
    report = await run_eval(settings, one("clear-01"), deps, "live")
    assert report["n_skipped"] == 1
    assert report["arms"]["A"]["intent_accuracy"]["overall"] == {"accuracy": None, "correct": 0, "n": 0}
    assert report["wer"]["overall"]["wer"] is None  # never a zero posing as a result


async def test_m10_mock_wer_perfect_for_clear_cases_and_nonperfect_for_atypical(settings):
    deps = EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), "v")
    r1 = await run_eval(settings, one("clear-02"), deps, "mock")
    assert r1["wer"]["overall"]["wer"] == 0.0
    r2 = await run_eval(settings, one("atypical-03"), deps, "mock")
    assert r2["wer"]["overall"]["wer"] > 0


# ------------------------------------------------------------------ HTTP
@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def test_m10_t08_no_runs_state_is_explicit(client):
    assert client.get("/eval/report").json() == {"status": "no_runs"}
    r = client.get("/eval/report.csv")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_m10_http_run_report_and_isolation(client, app):
    r = client.post("/eval/run", json={"mode": "mock"})
    assert r.status_code == 200
    s = r.json()
    assert s["status"] == "ok" and s["mode"] == "mock" and s["n_cases"] == 30 and s["n_skipped"] == 0
    assert s["disclaimer"] == "mock results are not measurements"
    rep = client.get("/eval/report").json()
    assert rep["mode"] == "mock" and rep["disclaimer"] and rep["n_cases"] == 30 and len(rep["cases"]) == 60
    assert app.state.sessions._sessions == {}  # the run used a private app; no sessions leaked into this one
    assert client.post("/eval/run", json={"mode": "other"}).status_code == 422
    assert client.post("/eval/run", json={}).status_code == 422


def test_m10_t10_csv_header_and_one_row_per_case_per_arm(client):
    client.post("/eval/run", json={"mode": "mock"})
    r = client.get("/eval/report.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8"))))
    assert list(rows[0].keys()) == M.CSV_COLUMNS
    assert len(rows) == 60
    assert {(x["case_id"], x["arm"]) for x in rows} == {(c.id, a) for c in load_scenarios(SCENARIOS).cases for a in "AB"}
    hi = next(x for x in rows if x["case_id"] == "lang-hi-01" and x["arm"] == "B")
    assert hi["reference_transcript"] == "मुझे पानी चाहिए" and hi["mode"] == "mock" and hi["correct"] == "True"


def test_m10_http_live_without_keys_503(client):
    r = client.post("/eval/run", json={"mode": "live"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "not_configured"
    assert client.get("/eval/report").json() == {"status": "no_runs"}  # a failed run leaves no report


def test_m10_http_live_with_injected_deps(app, tmp_path):
    clip = tmp_path / "c.wav"
    clip.write_bytes(b"RIFF")
    case = load_scenarios(SCENARIOS).cases[0].model_copy(update={"patient_audio_path": str(clip)})
    path = tmp_path / "s.json"
    path.write_text(json.dumps({"cases": [case.model_dump()]}), encoding="utf-8")
    app.state.settings.scenarios_path = path

    class F:
        def build(self, mode, settings):
            return EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), None, FakeTranscriber("Yes, I would like some water please."))

    app.dependency_overrides[get_eval_deps_factory] = lambda: F()
    with TestClient(app) as c:
        s = c.post("/eval/run", json={"mode": "live"}).json()
        assert s["mode"] == "live" and s["n_cases"] == 1 and s["n_skipped"] == 0 and "disclaimer" not in s
        rep = c.get("/eval/report").json()
        assert rep["mode"] == "live" and "disclaimer" not in rep


def test_m10_http_concurrent_run_rejected(client, monkeypatch):
    class Busy:
        def locked(self):
            return True

    monkeypatch.setattr(eval_router, "_lock", Busy())
    assert client.post("/eval/run", json={"mode": "mock"}).status_code == 409


def test_m10_live_factory_requires_both_keys():
    f = EvalDepsFactory()
    with pytest.raises(AppError) as ei:
        f.build("live", load_settings({"GROQ_API_KEY": "g"}, use_dotenv=False))
    assert ei.value.status == 503 and "ELEVENLABS_API_KEY" in ei.value.message and "GROQ" not in ei.value.message
    deps = f.build("live", load_settings({"GROQ_API_KEY": "g", "ELEVENLABS_API_KEY": "e", "DEFAULT_VOICE_ID": "v"}, use_dotenv=False))
    assert deps.transcriber is not None and deps.voice_id == "v"
