# PROGRESS LEDGER — PS-16 FastAPI backend

Claude Code: read this FIRST every session. Update it at the end of every module. Never mark a module Done unless its exit gate is fully true and `pytest -v` (full regression) is green.

Status values: Not started · In progress · Done · Blocked

| Module | Name | Status | Tests (module / regression) | Commit | Notes |
|---|---|---|---|---|---|
| M0 | Foundation | Done | 10/10 / 10/10 | M0: Foundation | Added internal_error (500) code for unhandled exceptions |
| M1 | Consent + Sessions | Done | 12/12 / 22/22 | M1: Consent + Sessions | I8 mutation checked |
| M2 | Conversation State | Done | 13/13 / 35/35 | M2: Conversation State | |
| M3 | Speech Input (Scribe) | Done (live test skipped) | 24 pass + 1 skip / 86 pass + 2 skip | M3: Speech Input (Scribe) | no key / clip for live test |
| M4 | Vision (MediaPipe) | Done (real-model path untested) | 28 pass + 1 skip / 63 pass + 1 skip | M4: Vision (MediaPipe) | .task files absent; real-model test skipped |
| M5 | Evidence Packet | Done | 16/16 / 102/102 (+2 skip) | M5: Evidence Packet | |
| M6 | Intent Fusion (Groq) | Done (live test skipped) | 39 pass + 1 skip / 141 pass + 3 skip | M6: Intent Fusion (Groq) | no GROQ_API_KEY |
| M7 | Human Confirmation | Done | 12/12 / 153 pass + 3 skip | M7: Human Confirmation | I1 mutation checked |
| M8 | Voice Output (TTS) | Done (live test skipped) | 22 pass + 1 skip / 175 pass + 4 skip | M8: Voice Output (TTS) | I1 + I8 mutation checked |
| M9 | Orchestrator + E2E | Done | 14/14 / 189 pass + 4 skip | M9: Orchestrator + E2E | all services faked |
| M10 | Evaluation | Done (mock only; live untested) | 24/24 / 213 pass + 4 skip | M10: Evaluation | no recordings/keys |
| M11 | Hardening / DoD | Done | 8/8 / 221 pass + 4 skip | M11: Hardening / Definition of Done | live paths unverified |
| M12 | Avatar (stretch, gated) | DO NOT START | | | Only if the user explicitly asks after M11 |

## Current module
M11 done. All of M0-M11 complete. M12 (avatar) NOT started; only if the user asks.

## Decisions log (append; newest last)
- M0: kit files copied into repo root (project = this folder, not ps16-assistant/). Venv at .venv.

## Assumptions log (append; copied from module reports)
- M0: unhandled exceptions return 500 `internal_error` in the standard shape (not in the CLAUDE.md code list).
- M0: HISTORY_WINDOW_TURNS outside 4-6 is a startup error.
- M0: X-Request-ID from client accepted only if [A-Za-z0-9._-]{1,64}, else regenerated.

- M1: POST /sessions returns 201; DELETE returns 204. Consent response adds recorded_ms (session clock) and recorded_at (UTC ISO). Cleanup hooks are sync callables; a failing hook is logged and does not block deletion.
- M2: render_context excludes the given turn BEFORE trimming so the window stays full. Typed text is stripped and capped at 1000 chars (422). GET /history limit is 1-200, default = window. Turn timestamps are clamped to never decrease.
- M4: both modes sit behind one VisionBackend.analyze(rgb, ts) -> Optional[FrameObs]. POST /vision/frame uses IMAGE mode, WS uses LIVE_STREAM (callbacks merged by LiveMerger, newest completed frame wins). Mouth/nod/stability thresholds are module constants in services/vision.py (starting values). gesture-map PUT needs no consent (it captures nothing); frame POST, cues GET and WS need face_capture. `mirrored` is a query param or multipart field, echoed only. Frames downscaled to max side 640.
- M3: batch response `turn` is null (nothing stored) when Scribe returns only whitespace. Realtime `committed` events with blank text are not stored. Realtime payload text read from `text` (fallback `transcript`) because SDK docstrings and API notes disagree. WS adds a `started` ack, checks consent after every received message (withdrawal stops audio immediately) and caps total streamed bytes at MAX_AUDIO_BYTES. stage_ms uses the app clock around the Scribe call only.
- M5: added CueTracker.cue_at(ts) (frames <= ts only, M4 current() behaviour unchanged) and ConversationState.get/latest/context_before. Context = up to N turns strictly BEFORE the target turn (later turns never leak). Cues are used only while face_capture consent is still true. Packet language = the turn's language. Gesture included only if stable.
- M6: FusionResult is strict (no type coercion). Groq strict json_schema uses a simplified wire schema (constraints dropped, all fields required, additionalProperties false); Pydantic is the real validator. UNVERIFIED against live Groq: whether strict mode accepts this schema and the `reasoning_effort` param for gpt-oss-120b. Prompt language follows the TURN language (defaults to session language). Fuse response adds stage_ms. Clarification proposals are stored as `pending` with fusion.clarification_required=true.
- M7: Proposal gained `turn_id` (additive); the effort chain = (session, patient turn), so re-fusing the same turn accumulates effort until a message is confirmed, then the chain resets. Repeating the same action is idempotent and not counted as extra effort. A clarification proposal with 0 candidates cannot be confirmed by index (409) but can be edited. `re_fuse_available` is always true after reject/clarify. No proposal-listing endpoint (out of spec).
- M8: Voice Design verified in installed SDK 2.75.0: text_to_voice.design(voice_description=) -> previews[].generated_voice_id -> text_to_voice.create(voice_name, voice_description, generated_voice_id) -> Voice.voice_id; first preview is auto-picked (no audition step). Speak streams audio/mpeg; first chunk is pulled before headers so errors still map to 502/503 and X-First-Audio-Ms is exact. Subtitle text travels percent-encoded in X-Subtitle-Text. Optional DEFAULT_VOICE_ID env gives a labelled `default_voice`. Session gained voice_id. Speak records go to app.state.speaklog (for M10). Provider-side minimum length of a voice description is unverified (short ones surface as 502).
- M9: /fuse and /turn/finish share services/pipeline.run_fusion. Metrics are per PATIENT-turn chain (partner turns create none); on a re-fuse the LATEST attempt's finish/proposal stamps are used so system_latency excludes rejected attempts' human time. vision_ms = processing time of the last frame finished before finish (per-frame cost, not end-to-end cue latency). First speak of a chain completes it (replays change nothing) and writes the JSONL line only with demo_use consent; logs dir = LOGS_DIR (default logs/). Realtime-WS turns have no scribe_ms. The no-speech scenario uses a blank patient turn injected into state, since silent transcriptions are never stored.
- M10: 30 scenarios (5 clear, 5 atypical-SIMULATED, 5 gesture, 5 context, 6 language en/hi/mixed x2, 4 negative); all patient_audio_path null. Runner drives each case through the real pipeline in a private app instance (own stores/clock), arm A without cues, arm B with. Cues are scripted from the scenario file. Simulated-patient effort policy: confirm if right; else reject + one re-fuse, then confirm or edit with the reference text; clarification cases end in clarify/reject. WER is corpus-level (micro), computed once per case from raw hypothesis. Mock uses rule-based MockChatLLM inside the real LLMIntentRanker, so validation/forced-clarification code is exercised; its numbers are by construction and labelled mock. /eval/report.csv returns 404 until a run exists. Settings gained EVAL_SCENARIOS.
- M11: CORS via CORS_ORIGINS (default none; CORSMiddleware sits inside the request-id middleware). Removed unused imports and the unused ErrorBody/ErrorResponse models. README rewritten (setup, .env, model downloads, curl loop, client contract). DoD test file covers the five blueprint items plus CORS, size limits and request-id-in-logs.

## Open questions
- To get real numbers: record consented clips, fill patient_audio_path in evaluation/scenarios.json, add ELEVENLABS_API_KEY + GROQ_API_KEY (+ DEFAULT_VOICE_ID), then POST /eval/run {"mode":"live"}.
- Live TTS test needs ELEVENLABS_API_KEY and DEFAULT_VOICE_ID (an existing voice id) in .env.
- Add ELEVENLABS_API_KEY to .env and a short clip in tests/data/ to run the M3 live test.
- Download face_landmarker.task and gesture_recognizer.task into assets/ so the real-model path can be verified. for the user
- (empty)

## Environment facts (fill in during M0)
- Python version: 3.10.11
- OS: Windows 11
- MediaPipe model files present: face_landmarker.task ☐ (missing)  gesture_recognizer.task ☐ (missing)
- Keys present in .env (yes/no only, never values): ELEVENLABS ☐  GROQ ☐
