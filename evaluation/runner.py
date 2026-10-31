"""Evaluation runner: drives each scenario through the REAL pipeline (M5-M9) in a private app instance.

Two modes:
  mock - injected transcripts + rule-based mock LLM/TTS. Output is labelled mock and is NOT a measurement.
  live - real Scribe / Groq / ElevenLabs on recordings the team supplies; cases without audio are skipped.

Cue values (gesture, mouth activity) come from the scenario file in both modes - they are scripted, not
measured from video. The patient is a SIMULATED policy (documented in the report), not a human.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI

from clock import Timer
from config import BASE_DIR, Settings
from errors import AppError
from evaluation import metrics as M
from evaluation.mock import MockChatLLM, MockSynth
from evaluation.schema import Scenario, ScenarioSet
from schemas import Language
from services.confirmation import ConfirmationService
from services.fusion import GroqChatLLM, IntentRanker, LLMIntentRanker
from services.pipeline import record_confirmed, record_speak, run_fusion
from services.scribe import ElevenLabsTranscriber, Transcriber, scribe_language_code
from services.tts import ElevenLabsSynthesizer, SpeechSynthesizer
from services.vision import FaceObs, FrameObs, GestureObs
from state.sessions import Session

Mode = Literal["mock", "live"]
MOCK_DISCLAIMER = "mock results are not measurements"
MOUTH_OPEN = {"jawOpen": 0.8, "mouthFunnel": 0.1}
MOUTH_CLOSED = {"jawOpen": 0.0, "mouthClose": 0.3}
POLICY = (
    "Simulated patient: confirms candidate 0 when the intent is right; otherwise rejects, asks for one re-fuse, "
    "then confirms if right or edits in the reference text. Cases expecting clarification end with a 'clarify' "
    "(or a reject if the system proposed replies). Human decision time is 0, so wall clock ~ system latency."
)


class EvalClock:
    """Real monotonic time plus a manual offset (used only to lay out scripted cue frames in time)."""

    def __init__(self) -> None:
        self._t0 = time.monotonic()
        self._offset = 0

    def now_ms(self) -> int:
        return int((time.monotonic() - self._t0) * 1000) + self._offset

    def advance(self, ms: int) -> None:
        self._offset += ms


@dataclass
class EvalDeps:
    ranker: IntentRanker
    synth: SpeechSynthesizer
    voice_id: Optional[str]  # None = TTS not run (latency then lacks the TTS leg)
    transcriber: Optional[Transcriber] = None  # None in mock mode (injected transcripts)


class EvalDepsFactory:
    def build(self, mode: Mode, settings: Settings) -> EvalDeps:
        if mode == "mock":
            return EvalDeps(LLMIntentRanker(MockChatLLM()), MockSynth(), "mock-voice", None)
        missing = [n for n, v in (("ELEVENLABS_API_KEY", settings.elevenlabs_api_key), ("GROQ_API_KEY", settings.groq_api_key)) if not v]
        if missing:
            raise AppError(503, "not_configured", f"Live evaluation needs {', '.join(missing)}")
        return EvalDeps(
            LLMIntentRanker(GroqChatLLM(settings)),
            ElevenLabsSynthesizer(settings),
            settings.default_voice_id or None,
            ElevenLabsTranscriber(settings),
        )


def get_eval_deps_factory() -> EvalDepsFactory:
    return EvalDepsFactory()


def _audio_path(case: Scenario) -> Optional[Path]:
    if not case.patient_audio_path:
        return None
    p = Path(case.patient_audio_path)
    return p if p.is_absolute() else BASE_DIR / p


async def _transcribe(case: Scenario, mode: Mode, deps: EvalDeps) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """(hypothesis, scribe_ms, skip_reason)."""
    if mode == "mock":
        return case.injected_transcript, None, None
    path = _audio_path(case)
    if path is None:
        return None, None, "no patient_audio_path in scenario (live mode needs a recording)"
    if not path.is_file():
        return None, None, f"audio file not found: {case.patient_audio_path}"
    assert deps.transcriber is not None
    timer = Timer(_wall)
    result = await deps.transcriber.transcribe(path.read_bytes(), path.name, None, scribe_language_code(case.language))
    return result.text, timer.elapsed_ms(), None


class _Wall:
    def now_ms(self) -> int:
        return int(time.monotonic() * 1000)


_wall = _Wall()


def _inject_cues(app: FastAPI, session: Session, case: Scenario) -> None:
    """Scripted cue frames that precede the patient turn (the eval has no video)."""
    if case.gesture is None and not case.mouth_activity:
        return
    tracker = app.state.vision.for_session(session.session_id).tracker
    base = session.clock.now_ms()
    for i in range(5):
        mouth = (MOUTH_OPEN if i % 2 == 0 else MOUTH_CLOSED) if case.mouth_activity else MOUTH_CLOSED
        g = GestureObs(case.gesture.label, case.gesture.score, "Right") if case.gesture else None
        tracker.observe(FrameObs(base + i * 100, FaceObs(mouth, 0.0), g))
    app.state.clock.advance(500)  # logical time passes so the frames precede the turn


async def _speak(app: FastAPI, session: Session, deps: EvalDeps, proposal_id: str, text: str) -> None:
    if not deps.voice_id:
        return
    received = session.clock.now_ms()
    timer = Timer(app.state.clock)
    agen = deps.synth.stream(text, deps.voice_id)
    first = b""
    async for chunk in agen:
        if chunk:
            first = chunk
            break
    aclose = getattr(agen, "aclose", None)
    if aclose is not None:
        await aclose()
    if first:
        await record_speak(app, session, proposal_id, received, session.clock.now_ms(), max(0, timer.elapsed_ms()))


async def _run_arm(
    case: Scenario, arm: str, hypothesis: str, scribe_ms: Optional[int], deps: EvalDeps, settings: Settings, mode: Mode
) -> dict[str, Any]:
    from main import create_app  # late import: main -> routers.eval -> this module

    include_cues = arm == "B"
    app = create_app(settings, clock=EvalClock())  # private app: stores, metrics and clock of its own
    session = app.state.sessions.create(case.language)
    session.consent.audio_recording = True
    session.consent.face_capture = True  # eval sessions are internal; real-data consent is the team's duty (README)
    for turn in case.context:
        session.conversation.add_turn(turn.speaker, turn.text, case.language, "typed")
    _inject_cues(app, session, case)
    turn = session.conversation.add_turn("patient", hypothesis, case.language, "scribe_batch" if mode == "live" else "typed")
    svc = ConfirmationService(app.state.proposals)

    async def fuse():
        run = await run_fusion(app, session, deps.ranker, turn.turn_id, include_cues)
        return run.proposal

    def judge(p) -> bool:
        return M.is_correct(case.group, p.fusion.intent, p.fusion.clarification_required,
                            case.expected_intent, case.intent_aliases, case.expected_clarification)

    proposal = await fuse()
    first_intent, first_clar = proposal.fusion.intent, proposal.fusion.clarification_required
    correct = judge(proposal)
    communicated = False
    spoken_text: Optional[str] = None
    effort: Optional[int] = None

    if case.group == "negative" or case.expected_clarification:
        r = svc.clarify(session, proposal.proposal_id) if proposal.fusion.clarification_required else svc.reject(session, proposal.proposal_id)
        effort = r.effort_actions
    else:
        result = None
        if correct and proposal.fusion.candidate_replies:
            result = svc.confirm(session, proposal.proposal_id, 0)
        else:
            svc.reject(session, proposal.proposal_id)
            proposal = await fuse()  # one re-fuse, as the real UI would offer
            if judge(proposal) and proposal.fusion.candidate_replies:
                result = svc.confirm(session, proposal.proposal_id, 0)
            else:
                result = svc.edit(session, proposal.proposal_id, case.reference_transcript)
        record_confirmed(app, session, result.proposal)
        communicated = True
        effort = result.effort_actions
        spoken_text = result.confirmed.text if result.confirmed else None
        if spoken_text:
            await _speak(app, session, deps, proposal.proposal_id, spoken_text)

    m = app.state.metrics.get(session.session_id, turn.turn_id)
    if m is not None and scribe_ms is not None:
        m.scribe_ms = scribe_ms
    w = M.wer(case.reference_transcript, hypothesis)
    return {
        "case_id": case.id, "arm": arm, "group": case.group, "language": case.language, "simulated": case.simulated,
        "skipped": False, "skip_reason": None, "mode": mode,
        "reference_transcript": case.reference_transcript, "hypothesis": hypothesis,
        "wer": w.wer, "wer_substitutions": w.substitutions, "wer_deletions": w.deletions, "wer_insertions": w.insertions,
        "wer_ref_words": w.ref_words,
        "expected_intent": case.expected_intent, "intent": first_intent,
        "expected_clarification": case.expected_clarification, "clarification_required": first_clar,
        "correct": M.is_correct(case.group, first_intent, first_clar, case.expected_intent,
                                case.intent_aliases, case.expected_clarification),
        "communicated": communicated, "effort_actions": effort,
        "scribe_ms": scribe_ms,
        "vision_ms": m.vision_ms if m else None,
        "fusion_ms": m.fusion_ms if m else None,
        "tts_first_audio_ms": m.tts_first_audio_ms if m else None,
        "system_latency_ms": m.system_latency_ms if m else None,
        "wall_clock_ms": m.wall_clock_ms if m else None,
    }


def _skipped(case: Scenario, arm: str, reason: str, mode: Mode) -> dict[str, Any]:
    return {
        "case_id": case.id, "arm": arm, "group": case.group, "language": case.language, "simulated": case.simulated,
        "skipped": True, "skip_reason": reason, "mode": mode,
        "reference_transcript": case.reference_transcript, "expected_intent": case.expected_intent,
        "expected_clarification": case.expected_clarification,
    }


async def run_eval(settings: Settings, scenarios: ScenarioSet, deps: EvalDeps, mode: Mode) -> dict[str, Any]:
    """Run every case in arms A (no cues) and B (cues). Transcription happens once per case."""
    records: list[dict[str, Any]] = []
    skipped_ids: list[str] = []
    for case in scenarios.cases:
        hypothesis, scribe_ms, reason = await _transcribe(case, mode, deps)
        if reason is not None or hypothesis is None:
            skipped_ids.append(case.id)
            records += [_skipped(case, arm, reason or "no transcript", mode) for arm in ("A", "B")]
            continue
        for arm in ("A", "B"):
            records.append(await _run_arm(case, arm, hypothesis, scribe_ms, deps, settings, mode))
    return build_report(records, scenarios, mode, skipped_ids, deps)


def build_report(records: list[dict[str, Any]], scenarios: ScenarioSet, mode: Mode, skipped_ids: list[str], deps: EvalDeps) -> dict[str, Any]:
    done = [r for r in records if not r["skipped"]]
    arm_a = M.summarize_arm([r for r in done if r["arm"] == "A"])
    arm_b = M.summarize_arm([r for r in done if r["arm"] == "B"])
    once = [r for r in done if r["arm"] == "B"]  # transcription is identical across arms
    wers = [M.WerResult(r["wer"], r["wer_substitutions"], r["wer_deletions"], r["wer_insertions"], r["wer_ref_words"]) for r in once]
    by_lang: dict[str, Any] = {}
    for lang in sorted({r["language"] for r in once}):
        by_lang[lang] = M.aggregate_wer([w for w, r in zip(wers, once) if r["language"] == lang])
    report: dict[str, Any] = {
        "status": "ok",
        "mode": mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_cases": len(scenarios.cases),
        "n_skipped": len(skipped_ids),
        "skipped_case_ids": skipped_ids,
        "normalization": M.NORMALIZATION,
        "patient_policy": POLICY,
        "cue_source": "scripted in scenarios.json (no video in evaluation)",
        "tts_run": bool(deps.voice_id),
        "wer": {"overall": M.aggregate_wer(wers), "by_language": by_lang,
                "note": "raw Scribe text vs manually checked reference; corpus-level (micro) average"},
        "arms": {"A": {"label": M.ARM_LABELS["A"], **arm_a}, "B": {"label": M.ARM_LABELS["B"], **arm_b}},
        "ablation": M.build_ablation(arm_a, arm_b),
        "cases": records,
    }
    if mode == "mock":
        report["disclaimer"] = MOCK_DISCLAIMER
    elif skipped_ids:
        report["note"] = f"{len(skipped_ids)} case(s) skipped: no usable recording"
    return report
