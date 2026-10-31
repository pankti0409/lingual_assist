"""Orchestrator: finish speaking -> evidence -> fusion -> proposal, plus timing records (blueprint §03).

Confirm (M7) and speak (M8) complete the loop; this module only wires them together and measures.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Optional

import anyio.to_thread
from fastapi import FastAPI

from clock import Timer
from schemas import Turn
from services.evidence import EvidencePacket, build_packet, resolve_patient_turn
from services.fusion import CLARIFICATION_MESSAGE, IntentRanker
from state.metrics import TurnMetrics
from state.proposals import Proposal
from state.sessions import Session

logger = logging.getLogger("ps16.pipeline")


@dataclass(frozen=True)
class FusionRun:
    proposal: Proposal
    packet: EvidencePacket
    stage_ms: int
    clarification_message: Optional[str]


async def run_fusion(
    app: FastAPI, session: Session, ranker: IntentRanker, turn_id: Optional[str], include_visual_cues: bool
) -> FusionRun:
    """Evidence (M5) -> fusion (M6) -> pending proposal; stamps finish/proposal times for the chain.

    On a re-fuse of the same turn the stamps of the LATEST attempt are kept, so system latency
    never includes the human time spent on a rejected attempt.
    """
    state = app.state
    turn = resolve_patient_turn(session, turn_id)
    finish_ms = session.clock.now_ms()
    vreg = state.vision
    vs = vreg.for_session(session.session_id) if vreg.has(session.session_id) else None
    packet = build_packet(session, turn, vs, include_visual_cues)
    timer = Timer(state.clock)
    fusion = await ranker.rank(packet)
    stage_ms = max(0, timer.elapsed_ms())
    proposal = state.proposals.add(session, turn.turn_id, packet.timestamp_ms, fusion)
    state.metrics.set(
        session,
        turn,
        finish_received_ms=finish_ms,
        proposal_ready_ms=session.clock.now_ms(),
        fusion_ms=stage_ms,
        vision_ms=vs.vision_ms_before(finish_ms) if vs is not None else None,
        intent=fusion.intent,
        clarification_required=fusion.clarification_required,
    )
    logger.info("fusion stage_ms=%d clarification=%s", stage_ms, fusion.clarification_required)
    return FusionRun(
        proposal=proposal,
        packet=packet,
        stage_ms=stage_ms,
        clarification_message=CLARIFICATION_MESSAGE if fusion.clarification_required else None,
    )


def record_scribe(app: FastAPI, session: Session, turn: Turn, scribe_ms: int) -> None:
    """Chains are patient turns; a partner turn's transcription time is not part of any chain."""
    if turn.speaker == "patient":
        app.state.metrics.set(session, turn, scribe_ms=scribe_ms)


def record_confirmed(app: FastAPI, session: Session, proposal: Proposal) -> None:
    turn = session.conversation.get(proposal.turn_id)
    if turn is not None:
        app.state.metrics.set_if_unset(session, turn, confirmed_ms=session.clock.now_ms())


async def record_speak(
    app: FastAPI, session: Session, proposal_id: str, speak_received_ms: int, first_audio_ms: int, tts_first_audio_ms: int
) -> None:
    """First speak of a chain completes it: stamp timings and, with demo_use consent, append a JSONL line."""
    proposal = app.state.proposals.get(session.session_id, proposal_id)
    turn = session.conversation.get(proposal.turn_id) if proposal is not None else None
    if turn is None:
        return
    m = app.state.metrics.set_if_unset(
        session,
        turn,
        speak_received_ms=speak_received_ms,
        first_audio_ms=first_audio_ms,
        tts_first_audio_ms=tts_first_audio_ms,
    )
    if m.first_audio_ms == first_audio_ms and m.speak_received_ms == speak_received_ms:  # this call completed it
        await write_log_line(app, session, m)


async def write_log_line(app: FastAPI, session: Session, m: TurnMetrics) -> bool:
    """Append one JSON line to logs/turns.jsonl - only with demo_use consent (I8); else memory only."""
    if not session.consent.demo_use:
        return False
    path = app.state.settings.logs_dir / "turns.jsonl"
    line = json.dumps(m.model_dump(), ensure_ascii=False)

    def _write() -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    try:
        await anyio.to_thread.run_sync(_write)
    except OSError:
        logger.exception("could not write turn log")
        return False
    return True
