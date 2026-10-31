# PS-16 Multimodal Live Conversation Assistant — FastAPI backend

Assistive-communication hackathon backend for people with speech impairments.
You are the engineer. Follow this file exactly; it is re-read every session.

## Where things live
- `docs/blueprint.md` — SOURCE OF TRUTH (team blueprint, extracted from the .docx). Re-read the relevant section before each module.
- `docs/MODULE_SPECS.md` — specs, decisions and acceptance tests for M0–M12. Read ONLY the current module's section.
- `docs/VERIFIED_API_NOTES.md` — API facts checked against official docs on 31 Oct 2026. Re-verify against the INSTALLED SDK before coding.
- `PROGRESS.md` — ledger. Read it first every session. Update it at the end of every module.

## Priority order if instructions conflict
1. Safety invariants (I1–I12 below)
2. The user's latest message
3. `docs/blueprint.md`
4. This file
5. `docs/MODULE_SPECS.md`
6. Your own judgment → pick the simplest option and record it under "Assumptions"

If the blueprint and an official API doc disagree: check the official doc, tell the user, ask before deviating.

## Product in one sentence
Capture patient + conversation partner → transcribe with ElevenLabs Scribe → extract face/hand cues with MediaPipe → context-aware LLM (Groq `openai/gpt-oss-120b`) ranks likely intended messages → patient confirms → ElevenLabs TTS speaks ONLY the confirmed message.

## Safety invariants (enforce in code AND in tests; never weaken)
- **I1 Patient control.** Never generate or play TTS for a message the patient has not explicitly confirmed (or edited-and-submitted). Enforced server-side: `/speak` accepts only a valid `confirmed_id`; anything else → HTTP 409.
- **I2 Clarify, don't guess.** Unclear transcript, conflicting/insufficient cues, no usable context, or invalid LLM output → explicit clarification response, never a guessed reply. Fixed text: `"I did not understand - please choose, repeat or clarify."`
- **I3 Evidence, not raw media.** Never send raw audio/video to the LLM. Only the compact timestamped evidence packet.
- **I4 No diagnosis, no emotion inference, no invented facts.** The LLM prompt forbids all three. Model "confidence" is not a calibrated probability — never present it as one.
- **I5 No lip-reading claims.** MediaPipe gives landmarks/blendshapes only. Derive `mouth_activity` and `head_nod` and nothing more.
- **I6 No inference from a single face frame.** Use short time windows.
- **I7 Gestures are user-calibrated.** Meaning comes from a per-session map. Demo default only: Thumb_Up=yes/confirm, Open_Palm=pause, Thumb_Down=no/reject.
- **I8 Consent.** No audio recording, face capture, voice cloning or demo use without recorded consent for that purpose. A designed voice is labelled `"persona":"designed_voice"` — never presented as a clone. Simulated atypical speech in test data is labelled simulated.
- **I9 Secrets.** Keys only from `.env` via python-dotenv. Never commit `.env`, never log or echo keys, never print them in reports.
- **I10 Honest metrics.** Never invent numbers. No vendor latency figures as system latency. No claim that gestures improve WER. Mock-mode eval output is labelled `"mode":"mock"` and is never presented as a measurement.
- **I11 Language claims.** English, Hindi and code-mixed are tested separately (transcription, LLM interpretation, TTS). Claim only what tests show.
- **I12 No avatar.** Blueprint §08 is out of scope. Do not write avatar code unless the user asks AFTER M11 passes.

## Scope fences — do NOT add without asking first
Databases, Redis, Celery, auth/login, Docker, a frontend, avatar code, object-pointing, emotion detection, diarization, any dependency not listed below, any endpoint not in `docs/MODULE_SPECS.md`. If you think something is needed, STOP and ask with a one-line justification.

Allowed dependencies: `fastapi`, `uvicorn[standard]`, `python-multipart`, `websockets`, `pydantic`, `python-dotenv`, `numpy`, `opencv-python` (or `-headless`), `mediapipe`, `elevenlabs`, `groq`, and test-only `pytest`, `pytest-asyncio`, `httpx`. Pin versions in `requirements.txt`; use stable releases, not pre-releases.

## Environment
- Python 3.10 or 3.11 (check `python --version` in M0; if different, STOP and tell the user).
- `.env` keys: `ELEVENLABS_API_KEY`, `GROQ_API_KEY`, `LLM_MODEL=openai/gpt-oss-120b`.
- Missing keys must never crash startup; the feature that needs a key returns `503 not_configured` when called.
- MediaPipe `.task` files live in `assets/` (user downloads them). If absent: vision tests skip with a clear message; vision endpoints return `503 not_configured`.

## Architecture rules
- Layout: `main.py`, `config.py`, `schemas.py`, `routers/` (thin HTTP/WS only), `services/`, `state/`, `evaluation/`, `assets/`, `tests/`.
- Every external dependency (ElevenLabs STT, ElevenLabs TTS, Groq, MediaPipe) sits behind an adapter with a Protocol/ABC, injected via FastAPI `Depends`, so tests use `app.dependency_overrides` with fakes.
- No blocking SDK/MediaPipe call on the event loop: use the official async clients or `anyio.to_thread.run_sync`.
- In-memory session store only. Never write raw audio or raw frames to disk. Voice-clone samples are forwarded to ElevenLabs from memory/temp file and deleted in `finally`.
- **Clock contract:** one session clock. `timestamp_ms` = server-side monotonic milliseconds since session creation. Audio turns, cues and staleness checks all use it. The clock is injectable (`Clock` protocol) so tests never sleep.
- **Error shape (all errors, including validation and 404):**
  `{"error":{"code":"<snake_case>","message":"...","request_id":"...","details":null}}`
  Codes: 403 `consent_required`, 404 `not_found`, 409 `invalid_state`, 413 `too_large`, 422 `validation_error`, 502 `upstream_error`, 503 `not_configured`.
- Tunables live in `config.py`, env-overridable. These are STARTING values, not validated results:
  `HISTORY_WINDOW_TURNS=6` (allowed 4–6) · `CUE_MAX_AGE_MS=1500` · `GESTURE_MIN_SCORE=0.6` · `GESTURE_STABILITY_FRAMES=3` · `MOUTH_WINDOW_MS=1000` · `HEAD_NOD_WINDOW_MS=1500` · `VISION_TARGET_FPS=5` · `MAX_AUDIO_BYTES=20_000_000` · `MAX_FRAME_BYTES=2_000_000` · `LLM_REASONING_EFFORT=low` · `LLM_MAX_COMPLETION_TOKENS=1024` · `LLM_TEMPERATURE=0.2` · `LLM_TIMEOUT_S=10` · `TTS_MODEL=eleven_flash_v2_5` · `SCRIBE_BATCH_MODEL=scribe_v2` · `SCRIBE_REALTIME_MODEL=scribe_v2_realtime`.

## Never write SDK code from memory
SDKs change (ElevenLabs ships pre-releases; MediaPipe/Groq APIs evolve). Before writing any adapter:
1. Read the matching section of `docs/VERIFIED_API_NOTES.md`.
2. Introspect the INSTALLED package (`python -c "import elevenlabs, inspect; ..."`, `help(...)`) and confirm method names and parameters exist.
3. If the doc, the notes and the installed SDK disagree, STOP and report. Do not guess a signature.

## Workflow — ONE MODULE AT A TIME (M0 → M11; M12 only if the user asks)
For the current module only:
1. **Read** `PROGRESS.md`, the module's section in `docs/MODULE_SPECS.md`, and the mapped blueprint section.
2. **Plan** in 5–10 lines (what, which blueprint section, files). Continue without waiting unless the plan exposes a blocker or ambiguity — then ask.
3. **Implement only that module.** Do not write code for later modules (no stubs, no TODO scaffolds beyond what the module needs).
4. **Write the tests first or alongside** (`tests/test_mX_<name>.py`). Test IDs from the spec (e.g. `M3-T04`) appear in test names/docstrings so coverage is traceable.
5. **Run** `pytest tests/test_mX_<name>.py -v`, then the full regression `pytest -v`. Both must be green.
6. **Fix** failures. Max 3 fix attempts per failure; then STOP and report the real failure. Never delete, loosen, `skip`, or `xfail` a test to get green. Never fake or paraphrase test output.
7. **Invariant mutation check** (modules that own an invariant: M1, M7, M8): temporarily break the guard (e.g. let `/speak` accept an unconfirmed id), show the named test fails, restore it, show it passes. Report this in one line.
8. **Update** `PROGRESS.md`; if git is initialised, commit `M<n>: <title>` (never commit `.env` or `assets/*.task`).
9. **Print the module report** (format below), then **STOP and wait for the user to say "next"**.

### Module report — print exactly this
```
MODULE REPORT — M<n> <name> (blueprint §<sections>)
Files created/changed: ...
Endpoints added: METHOD /path ...
Tests: <module> <passed>/<total> | regression <passed>/<total> | command: ...
Live tests: ran / skipped (reason)
Invariant check: <I#> broken → <test id> failed → restored → passed   (or n/a)
Blueprint compliance: <requirement → file/test> one line each
Deviations from blueprint: none | <list + why>
Assumptions: ...
Open questions: ...
Try it: <curl commands or /docs>
```

## Testing policy
- Default `pytest` is offline, fast and deterministic: fakes/mocks for ElevenLabs and Groq, `FakeClock`, no `sleep` waits.
- `conftest.py` has an autouse fixture that blocks outbound connections to non-loopback hosts for tests not marked `live` (allow loopback: asyncio on Windows uses it internally).
- Live tests: `@pytest.mark.live`, auto-skipped when the needed key is missing. Required live tests: Scribe (M3), Groq (M6), TTS (M8). Run with `pytest -m live`.
- Vision tests use small static/synthetic images and the real `.task` models; skip with a clear message if models are absent.
- `pytest.ini`: `asyncio_mode = auto`, register the `live` marker.
- Assert behaviour and values, not just status codes. Every module needs negative and edge cases. No tautological asserts. No test that passes when the feature is deleted.
- Tests never read real keys; set env via `monkeypatch`.

## Stop-and-ask conditions
STOP and ask the user (do not assume) when: a needed API key/model file is missing for a LIVE test you must run; an SDK method in the notes does not exist; the blueprint contradicts an official doc; a test would have to be weakened; a new dependency or endpoint seems necessary; the Python version is wrong.

## Style
Type hints everywhere, Pydantic v2 models for every request/response, small functions, docstrings that cite the blueprint section for non-obvious rules, `logging` (no `print`) with request IDs, no secrets in logs.
