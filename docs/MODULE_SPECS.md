# MODULE SPECS — PS-16 FastAPI backend

Read only the module you are working on. Rules in `CLAUDE.md` always apply.
Each module ends with an EXIT GATE: do not report the module done until every box is true.
Test IDs (`M3-T04`) must appear in test names or docstrings.

Blueprint section map: §01 problem/requirements/evaluation · §02 stack · §03 pipeline · §04 components A–E · §05 fusion logic · §06 execution/structure/setup · §07 testing/acceptance · §08 avatar (out of scope) · §09 datasets.

---

## Shared contracts (used by several modules — define in `schemas.py` as the modules need them)

**Speaker:** `"patient" | "partner"` (lowercase in JSON, matching the blueprint packet).
**Turn:** `{turn_id, speaker, text, language, timestamp_ms, source: "scribe_batch"|"scribe_realtime"|"typed"}`.
**Language preference:** `"en" | "hi" | "mixed"`. For Scribe, `en`→`language_code="eng"`, `hi`→`"hin"`; `mixed` (code-mixed) → OMIT `language_code` so the model auto-detects (see VERIFIED_API_NOTES).
**Evidence packet** (exact blueprint shape; one documented additive field `gesture.meaning`):
```json
{
  "speaker": "patient",
  "transcript": "wa... water",
  "language": "en",
  "timestamp_ms": 12400,
  "conversation_context": [{"speaker": "partner", "text": "Water or tea?"}],
  "visual_cues": {
    "gesture": {"label": "Thumb_Up", "score": 0.91, "meaning": "yes"},
    "mouth_activity": true,
    "head_nod": false
  }
}
```
`gesture` is `null` when no stable, fresh, above-threshold gesture exists. `mouth_activity` and `head_nod` are booleans (`false` when unknown).
**Fusion result** (Pydantic, `extra="forbid"`):
```json
{"intent": "request_water",
 "candidate_replies": ["I would like water, please.", "Could I have some water?"],
 "clarification_required": false,
 "reasoning_summary": "Transcript and recent question align."}
```
Rules: `intent` snake_case string, ≤ 60 chars · each reply ≤ 200 chars, non-empty · if `clarification_required=false` → exactly 2–3 replies · if `true` → 0–3 replies allowed (the API adds the fixed clarification text) · `reasoning_summary` ≤ 300 chars.
**Proposal:** `{proposal_id, session_id, evidence_timestamp_ms, fusion, state, created_ms}`; ids are `uuid4().hex`. A proposal is visible only inside its own session; foreign id → 404.
**Proposal states:** `pending → confirmed | edited_confirmed | rejected | clarification_requested`.
**Confirmed message:** `{confirmed_id, proposal_id, text, how: "candidate"|"edited", candidate_index|null}`.

---

## M0 — Foundation  (blueprint §06 setup + structure, §02 stack)

**Build**
- `main.py` app factory `create_app(settings=None)`; `config.py` (settings from `.env`; all tunables from CLAUDE.md); `schemas.py` (error model + shared types as needed).
- `GET /health` → `{status:"ok", python:"3.x", services:{elevenlabs:bool, groq:bool}, models:{llm, tts, scribe_batch, scribe_realtime}, assets:{face_landmarker:bool, gesture_recognizer:bool}}`. Booleans = "configured"; never return key values or prefixes.
- Global exception handlers → the standard error shape (including FastAPI validation errors and unknown routes).
- Request-ID middleware (header `X-Request-ID`, generated if absent) and structured logging.
- `Clock` protocol + `SystemClock` + `FakeClock`; a `Timer` helper (monotonic ms).
- `.env.example` (3 keys, no real values), pinned `requirements.txt`, `.gitignore` (`.env`, `.venv`, `__pycache__`, `assets/*.task`, `logs/`), `README.md` skeleton, `pytest.ini`, `tests/conftest.py` (network block fixture, `live` marker, app/client fixtures).

**Tests**
- M0-T01 app boots; `/health` 200 and schema-correct.
- M0-T02 `/health` never contains key values (set a fake key, assert it appears nowhere in the response body or logs).
- M0-T03 missing keys → reported `false`, app still starts.
- M0-T04 settings read from env; invalid numeric env → clear startup error naming the variable.
- M0-T05 unknown route → 404 standard error shape with `request_id`.
- M0-T06 invalid request body → 422 standard error shape (not FastAPI default).
- M0-T07 `X-Request-ID` echoed or generated.
- M0-T08 network-block fixture works: a non-live test that tries a non-loopback connect fails with a clear message.
- M0-T09 `FakeClock` advances only when told; `Timer` measures with it.

**Exit gate:** ☐ Python 3.10/3.11 confirmed ☐ all M0 tests green ☐ `PROGRESS.md` updated.

---

## M1 — Consent + Sessions  (blueprint §01 "Consent")

**Build** `services/consent.py`, `routers/sessions.py`, in-memory `SessionStore` (create/get/delete, per-session lock, session clock).
- `POST /sessions` body `{language:"en"|"hi"|"mixed" (default "en"), voice_mode:"clone"|"designed"|"none" (default "none")}` → `{session_id, ...}`.
- `POST /sessions/{id}/consent` body `{audio_recording, face_capture, voice_cloning, demo_use}` (all booleans, all default false) → stored with server timestamp. A later call replaces the flags and stamps again.
- `GET /sessions/{id}`; `DELETE /sessions/{id}` (removes history, cues, proposals, metrics, vision resources — design `SessionStore.delete` to call a cleanup hook that later modules register).
- Reusable dependency `require_consent("face_capture")` (also `audio_recording`, `voice_cloning`, `demo_use`) → 403 `consent_required` naming the missing purpose.

**Tests**
- M1-T01 create/read/delete roundtrip; defaults applied.
- M1-T02 consent defaults to all false.
- M1-T03 consent persists and is timestamped; updating replaces flags.
- M1-T04 `require_consent` → 403 without, passes with (use a tiny test route).
- M1-T05 delete removes everything; subsequent GET → 404; cleanup hook is invoked.
- M1-T06 unknown session → 404 standard shape.
- M1-T07 invalid language/voice_mode → 422.
- M1-T08 two sessions are isolated (consent for one does not leak to the other).
- **Invariant mutation (I8):** break `require_consent`, show M1-T04 fails, restore.

**Exit gate:** ☐ regression green ☐ mutation check shown ☐ PROGRESS updated.

---

## M2 — Conversation State  (blueprint §03 step 04, §05 "Load the last 4–6 dialogue turns")

**Build** `state/conversation.py`: per-session ordered turns with speaker, text, language, `timestamp_ms`, source.
- `add_turn(speaker, text, language, source)` stamps with the session clock. `recent(n=settings.HISTORY_WINDOW_TURNS)` returns the last n in order. `render_context(n, exclude_turn_id=None)` returns `[{"speaker","text"}]` (blueprint shape).
- `GET /sessions/{id}/history?limit=` and `POST /sessions/{id}/turns/text` (body `{speaker, text, language?}`; typed-turn fallback/testing; empty or whitespace text → 422).
- Window config validated to 4–6.

**Tests**
- M2-T01 speaker labels preserved; patient and partner never swapped.
- M2-T02 window trims to N and keeps chronological order.
- M2-T03 timestamps non-decreasing with `FakeClock`.
- M2-T04 empty history renders `[]`.
- M2-T05 `render_context` shape equals the blueprint example exactly.
- M2-T06 `exclude_turn_id` omits the current patient turn from context.
- M2-T07 window outside 4–6 → config error.
- M2-T08 whitespace-only text → 422; unknown speaker → 422.
- M2-T09 sessions isolated.

---

## M3 — Speech Input / Scribe  (blueprint §04-A, §03 step 02)

**Build** `services/scribe.py` with `Transcriber` Protocol and two implementations. Build and finish (a) before starting (b).
**(a) Batch** — `POST /sessions/{id}/transcribe` multipart `{audio, speaker, language?}`. Calls Scribe v2 batch (`scribe_v2`). Appends a turn whose `text` is the RAW Scribe text, unmodified (needed for WER). Response: `{turn, raw_text, language_code, language_probability, duration_s?, stage_ms}`. Requires `audio_recording` consent. Reject empty/oversized audio (413 at `MAX_AUDIO_BYTES`). Speaker comes ONLY from the param (no diarization).
**(b) Realtime** — `WS /ws/sessions/{id}/scribe`, using `scribe_v2_realtime`:
- Client first sends JSON `{"type":"start","speaker":"patient|partner","language":"en|hi|mixed"}`; then binary frames of PCM 16-bit mono 16 kHz; `{"type":"commit"}` = user-triggered "finish speaking" (use manual commit); `{"type":"stop"}` closes.
- Server emits `{"type":"partial"|"committed","text":...,"speaker":...,"timestamp_ms":...}` and `{"type":"error","code":...}`.
- Only `committed` text enters history (as a turn). Partials are never stored.
- Requires `audio_recording` consent (check at connect; close with an error message if absent).
- Do NOT add audio re-encoding libraries (no pydub/ffmpeg). The WS contract requires clients to send PCM16 16 kHz mono; batch accepts the formats Scribe accepts.

**Tests (fake transcriber unless marked live)**
- M3-T01 patient and partner uploads → two correctly labelled turns in order.
- M3-T02 invalid speaker → 422; missing file → 422.
- M3-T03 empty audio → 4xx; oversized → 413.
- M3-T04 no `audio_recording` consent → 403, nothing stored.
- M3-T05 raw text stored byte-for-byte (include punctuation/ellipsis/Devanagari sample).
- M3-T06 `language=mixed` → adapter called WITHOUT `language_code`; `en`/`hi` → `eng`/`hin`.
- M3-T07 provider failure → 502 standard shape, nothing stored.
- M3-T08 missing `ELEVENLABS_API_KEY` → 503 `not_configured`.
- M3-T09 WS: partials then committed; only committed in history.
- M3-T10 WS: no consent → error + close; bad start message → error.
- M3-T11 WS: manual `commit` triggers a committed event with the fake.
- M3-T12 `stage_ms` present and ≥ 0.
- M3-LIVE (`@pytest.mark.live`) transcribe a short real clip from `tests/data/` (user provides; skip with message if absent).

---

## M4 — Vision / MediaPipe  (blueprint §04-B face/mouth, §04-C gestures)

**Build** `services/vision.py`, `routers/vision.py`.
- Decode JPEG/PNG with OpenCV, **convert BGR→RGB before `mp.Image`**, resize, stamp with the session clock.
- `FaceLandmarker` (blendshapes + facial transformation matrix ON) → `mouth_activity` (bool + score) from changes in `jawOpen`, `mouthClose`, `mouthFunnel`, `mouthStretchLeft/Right`, over `MOUTH_WINDOW_MS`; `head_nod` (bool) from pitch oscillation of the transformation matrix (or landmark y-motion) over `HEAD_NOD_WINDOW_MS`. Both are windowed — a single frame can never flip them.
- `GestureRecognizer` → `{label, score, handedness}` per frame.
- **Stability:** a gesture is "stable" only if the same label (non-`None`, score ≥ `GESTURE_MIN_SCORE`) appears in `GESTURE_STABILITY_FRAMES` consecutive recent frames. Cues older than `CUE_MAX_AGE_MS` are stale and ignored.
- **Modes:** blueprint says `LIVE_STREAM`. Use `LIVE_STREAM` for the streaming path (`WS`), with one landmarker/recognizer per session, monotonically increasing timestamps, and the async result callback writing into a per-session "latest result" slot. Use `IMAGE` mode for the stateless single-frame endpoint and for unit tests. Record this as an Assumption in the report; both modes sit behind one `VisionBackend` Protocol.
- Per-session gesture map: `PUT /sessions/{id}/gesture-map` body `{"Thumb_Up":"yes","Open_Palm":"pause","Thumb_Down":"no"}`; keys must be among the 8 built-ins (`Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou, None`); values are non-empty strings ≤ 40 chars. Default = demo map from CLAUDE.md I7.
- Keep only derived features. Never store, log or forward raw frames. Lazily create MediaPipe objects per session; close them on session delete (register the M1 cleanup hook).
- Mirroring: document in README that clients must send un-mirrored frames (mirroring swaps left/right blendshapes and handedness). Add an optional `mirrored:bool` request field that is only echoed in the response — do NOT attempt to correct for it.
- Out of scope: object pointing, emotion, lip reading.

**Endpoints** `POST /sessions/{id}/vision/frame` (multipart/octet image) · `WS /ws/sessions/{id}/vision` (binary JPEG frames in, cue JSON out; latest-frame-wins if the server falls behind — drop, don't queue) · `GET /sessions/{id}/vision/cues` · `PUT /sessions/{id}/gesture-map`.
Cue JSON: `{timestamp_ms, face:{detected, mouth_activity, mouth_score, head_nod}, gesture:{label, score, handedness, stable, meaning}|null}`.

**Tests**
- M4-T01 valid image → structured cue with timestamp.
- M4-T02 image without face/hand → `detected:false`, `gesture:null`, no crash.
- M4-T03 corrupt bytes → 422; oversized → 413.
- M4-T04 stale cue (advance `FakeClock` past `CUE_MAX_AGE_MS`) not returned as current.
- M4-T05 gesture below `GESTURE_MIN_SCORE` ignored (inject via a fake backend).
- M4-T06 stability needs N consecutive agreeing frames; one flicker resets it.
- M4-T07 `mouth_activity` windowed: one open-mouth frame among closed frames stays false; sustained variation → true.
- M4-T08 `head_nod` needs oscillation, not a single tilt.
- M4-T09 gesture-map rejects unknown labels and empty values; accepts the demo map.
- M4-T10 no `face_capture` consent → 403.
- M4-T11 no raw frame persisted (assert no file written, no raw bytes in session state or logs).
- M4-T12 BGR→RGB conversion is applied (use a synthetic image with distinct R/B and assert the array handed to the backend).
- M4-T13 WS: frames in, cues out; slow consumer drops frames rather than queueing.
- M4-T14 missing `.task` files → 503 `not_configured`; real-model tests skip with message.
- M4-T15 session delete closes MediaPipe objects.

---

## M5 — Evidence Packet  (blueprint §05 "Suggested evidence packet", §03 step 04)

**Build** `services/evidence.py`; `POST /sessions/{id}/evidence` body `{turn_id?: latest patient turn, include_visual_cues: true}`.
- Build ONE packet in the exact shape from "Shared contracts". `timestamp_ms` = the patient turn's timestamp. Context = last 4–6 turns EXCLUDING the current patient turn.
- Visual cues: latest stable, non-stale, above-threshold gesture within `CUE_MAX_AGE_MS` of the turn; `meaning` from the session gesture map (null if unmapped). `mouth_activity`/`head_nod` windowed values at that time.
- `include_visual_cues=false` returns the same packet with `visual_cues` = `{"gesture":null,"mouth_activity":false,"head_nod":false}` — required for the M10 ablation (A: no cues).
- Language = session language preference unless the turn carries a detected language.

**Tests**
- M5-T01 packet validates against the Pydantic model and equals the blueprint example for the water scenario (partner "Water or tea?", patient "wa... water", Thumb_Up 0.91).
- M5-T02 stale and low-score gestures dropped (→ `gesture:null`), not sent as truth.
- M5-T03 context has ≤ N turns, chronological, excludes the current turn.
- M5-T04 no raw-media fields anywhere in the packet (walk the dict).
- M5-T05 no cues at all → `visual_cues` present with null/false, HTTP 200.
- M5-T06 deterministic: same state → identical packet.
- M5-T07 `include_visual_cues=false` strips cues only.
- M5-T08 no patient turn yet → 409 `invalid_state`; unknown `turn_id` → 404.
- M5-T09 partner-turn id given → 422 (packet is for the patient's turn).

---

## M6 — Intent Fusion / Groq LLM  (blueprint §04-D, §05 "Fusion logic")

**Build** `services/fusion.py` (`IntentRanker` Protocol + Groq implementation), `POST /sessions/{id}/fuse`.
- Call Groq chat completions with model from `LLM_MODEL`, `reasoning_effort=low`, `temperature` low, `max_completion_tokens` large enough to hold reasoning + JSON (see notes), `response_format` JSON-schema from the Pydantic model. **Always** re-validate with Pydantic regardless of provider enforcement.
- System prompt (use this text, fill `{language_style}`):
  > You help interpret the intended message of a person with a speech impairment. You receive one JSON evidence packet.
  > Rules: Use ONLY the supplied evidence. Do not invent facts, names, needs or medical details. Do NOT diagnose any condition. Do NOT infer emotion or mood from visual cues. Visual cues are weak movement signals; a gesture's meaning is only what `gesture.meaning` states. The transcript may be partial, slurred or misrecognised — prefer interpretations consistent with BOTH the transcript and the recent conversation. If the evidence is insufficient, ambiguous or conflicting, set `clarification_required` to true. Write 2–3 short first-person replies the patient could say, in {language_style}. Return JSON only, matching the schema, no markdown.
  `language_style`: `en`→"English", `hi`→"Hindi (Devanagari script)", `mixed`→"the same Hindi–English mix the patient used".
- Validate → on malformed/invalid output **retry once** → still invalid → return the clarification result (I2). Truncated JSON counts as malformed.
- **Code-level forced clarification (no LLM call):** transcript empty/whitespace AND no stable gesture. Never override an LLM `clarification_required=true` to false.
- `POST /sessions/{id}/fuse` body `{turn_id?, include_visual_cues?: true}` → builds the evidence packet (M5), runs fusion, stores a `pending` proposal, returns `{proposal, evidence}`. If clarification: response includes `clarification_message` (fixed text from I2).
- Log fusion stage ms. Never include raw media in the request (assert on the built messages).

**Tests (LLM mocked unless live)**
- M6-T01 valid JSON accepted; proposal stored as `pending`.
- M6-T02 malformed JSON → exactly one retry; second valid output accepted.
- M6-T03 malformed twice → clarification result, no exception, no candidates guessed.
- M6-T04 extra field → rejected; missing field → rejected; 1 candidate with `clarification_required=false` → rejected; 4 candidates → rejected; over-length reply → rejected.
- M6-T05 `clarification_required=true` passes through with 0–3 replies and the fixed message.
- M6-T06 empty transcript + no gesture → clarification WITHOUT calling the LLM (assert fake not called).
- M6-T07 captured system prompt contains the evidence-only, no-diagnosis and no-emotion rules.
- M6-T08 water scenario with a scripted fake → water-intent candidates in the proposal.
- M6-T09 captured request contains only the packet (no bytes/base64/frames/audio keys).
- M6-T10 provider error/timeout → 502 standard shape; missing key → 503.
- M6-T11 `language_style` follows session language.
- M6-T12 conflicting-evidence scenario: fake returns `clarification_required=true` → proposal reflects it; no candidates auto-selected.
- M6-LIVE one real Groq call returns schema-valid JSON for the water scenario.

---

## M7 — Human Confirmation  (blueprint §05 "Patient control is a core feature")

**Build** `services/confirmation.py` state machine + `routers/proposals.py`.
- `POST /sessions/{id}/proposals/{pid}/confirm` body `{candidate_index}` → state `confirmed`, issues `confirmed_id`.
- `.../edit` body `{text}` (non-empty, ≤ 300 chars, trimmed) → the patient authored the exact final text; state `edited_confirmed`, issues `confirmed_id`. (Clients should show the preview before submitting — noted in README.)
- `.../reject` → state `rejected`, never issues an id; response says whether a re-fuse is available.
- `.../clarify` → state `clarification_requested` (patient asks to repeat/clarify).
- Decisions: re-sending the SAME confirm/edit is idempotent (same `confirmed_id`); a DIFFERENT action on a terminal proposal → 409 `invalid_state`. Terminal states: all except `pending`.
- Effort counter per proposal chain: each patient action (confirm, edit, reject, clarify) = 1; re-fuse after reject/clarify links the new proposal to the same message chain so effort accumulates until a message is confirmed. Expose `effort_actions` on confirmed messages for M10.
- `GET /sessions/{id}/confirmed/{confirmed_id}` for M8/M9.

**Tests**
- M7-T01 confirm returns `confirmed_id`; text equals candidate text exactly.
- M7-T02 edit stores exact edited text (preserve Devanagari/punctuation); empty/over-long → 422.
- M7-T03 reject → no `confirmed_id` exists for that proposal.
- M7-T04 clarify → state `clarification_requested`, no id.
- M7-T05 foreign/unknown proposal id → 404; proposal from another session → 404.
- M7-T06 candidate_index out of range → 422.
- M7-T07 idempotent repeat returns the same `confirmed_id`; conflicting action → 409.
- M7-T08 effort counter increments per action and accumulates across a re-fuse chain.
- **M7-T09 NOTHING is speakable before confirmation:** a `pending`, `rejected` or `clarification_requested` proposal never yields a `confirmed_id`, and a guessed/random id cannot be resolved. (Explicit test, required.)
- M7-T10 clarification proposals (`clarification_required=true`) cannot be "confirmed" by index when they have 0 candidates → 409/422.
- **Invariant mutation (I1):** make confirmation issue ids for pending proposals, show M7-T09 fails, restore.

---

## M8 — Voice Output / ElevenLabs TTS  (blueprint §04-E, §01 personalised output)

**Build** `services/tts.py` (`SpeechSynthesizer` Protocol + ElevenLabs implementation), `routers/voice.py`.
- `POST /sessions/{id}/speak` body `{confirmed_id}` ONLY. The text spoken is read from the stored confirmed message — the endpoint never accepts free text. Model `eleven_flash_v2_5`, session `voice_id`. Returns audio (`audio/mpeg`) streamed where supported, with headers/JSON for subtitle text and `X-First-Audio-Ms`. Missing/unknown/unconfirmed `confirmed_id` → 409 (unknown id → 404). Replaying an already-spoken confirmed id is allowed (the patient confirmed that exact text); each speak is logged.
- Voices: `GET /voices`; `POST /voices/clone` (multipart sample + `name` + `session_id`) → requires `voice_cloning` consent, stores the returned `voice_id` on the session (`voice_mode="clone"`); `POST /voices/design` (description) → stores `voice_id`, response `{"persona":"designed_voice", ...}`; `voice_mode="designed"`. Verify the Voice Design SDK method name against the installed SDK before coding (see notes).
- No voice set for the session → use a clearly labelled default/designed voice only if configured, else 409 `invalid_state` ("no voice selected").
- Record time-to-first-audio-byte (`tts_first_audio_ms`).

**Tests (TTS faked unless live)**
- M8-T01 `/speak` without `confirmed_id` → 422/409; unknown id → 404.
- M8-T02 pending/rejected/clarification proposal id (not a confirmed id) → 409; synthesizer never called (assert).
- **M8-T03** text sent to the synthesizer equals the confirmed text byte-for-byte (English, Hindi, code-mixed samples).
- M8-T04 clone without `voice_cloning` consent → 403; synthesizer/clone client never called.
- M8-T05 designed voice response carries `"persona":"designed_voice"`.
- M8-T06 provider failure → 502; missing key → 503.
- M8-T07 first-audio latency recorded and ≥ 0.
- M8-T08 model used is `eleven_flash_v2_5` and the session's `voice_id`.
- M8-T09 clone sample is not left on disk after the request.
- M8-T10 no voice selected → 409.
- M8-LIVE synthesize a short sentence → non-empty audio bytes.
- **Invariant mutation (I1):** let `/speak` accept an unconfirmed id, show M8-T02 fails, restore.

---

## M9 — Orchestrator + End-to-End  (blueprint §03 whole pipeline, §06 "complete core loop")

**Build** `services/pipeline.py`, `routers/turns.py`.
- `POST /sessions/{id}/turn/finish` ("finish speaking"): uses the latest committed patient turn → collects cues → loads history → evidence (M5) → fusion (M6) → returns the proposal. Confirm (M7) → speak (M8) completes the loop. Add nothing beyond the blueprint flow.
- **Timing (per message chain), written as one JSON line to `logs/turns.jsonl` and exposed at `GET /sessions/{id}/metrics`:** `scribe_ms`, `vision_ms`, `fusion_ms`, `tts_first_audio_ms`, `finish_received_ms`, `proposal_ready_ms`, `confirmed_ms`, `speak_received_ms`, `first_audio_ms`, plus
  - `system_latency_ms` = (`proposal_ready_ms` − `finish_received_ms`) + (`first_audio_ms` − `speak_received_ms`) — excludes human decision time,
  - `wall_clock_ms` = `first_audio_ms` − `finish_received_ms` — includes human decision time,
  - `human_wait_ms` = `confirmed_ms` − `proposal_ready_ms`.
  Report both honestly in M10; the blueprint's "under 2 seconds" is checked against `system_latency_ms` AND shown next to wall clock. Do not claim a pass without measurement.
- Log line fields (blueprint §07 DoD): `session_id`, `turn_id`, `language`, `transcript_raw`, `reference_transcript` (null outside eval), `intent`, `clarification_required`, all timings. Only write the log when the session has `demo_use` consent; otherwise keep metrics in memory only.
- Sessions must not leak state into each other under concurrent requests.

**Tests (all external services faked)**
- M9-T01 happy path: partner "Water or tea?" → patient "wa... water" + Thumb_Up → proposal with water candidates → confirm → speak returns audio bytes.
- M9-T02 conflicting-cues scenario → clarification, `/speak` impossible.
- M9-T03 no-speech scenario → clarification without LLM call.
- M9-T04 reject path → no audio ever produced.
- M9-T05 every timing field present, non-negative, logged separately (do NOT assert total ≥ sum of parts).
- M9-T06 `system_latency_ms` excludes human wait (use `FakeClock` with a long human delay).
- M9-T07 two concurrent sessions (asyncio.gather) stay isolated.
- M9-T08 JSONL line contains language/transcript/intent/timings and is only written with `demo_use` consent.
- M9-T09 `turn/finish` with no patient turn → 409.

---

## M10 — Evaluation  (blueprint §01 evaluation, §07 metrics + ablation)

**Build** `evaluation/metrics.py`, `evaluation/scenarios.json`, `routers/eval.py`.
- **Scenarios** cover the blueprint's six groups: clear speech ×5; atypical/simulated speech ×5 (`"simulated": true`); gesture support ×5; conversation context ×5; language (English, Hindi, code-mixed) ×≥3 separate; negative/ambiguous (conflicting cues, no gesture, noise, no speech). Schema per case: `id, group, language, simulated, context[], patient_audio_path|null, reference_transcript, injected_transcript (mock mode), gesture{label,score}|null, mouth_activity, expected_intent, intent_aliases[], expected_clarification`. Do NOT fabricate audio or "real" results — audio paths point to files the team records; cases without audio are reported as `skipped` in live mode.
- **WER** = (S + D + I) / reference words × 100 via your own word-level Levenshtein. Normalisation (applied identically to reference and hypothesis, documented in the report): Unicode NFC, lowercase, strip punctuation, whitespace tokenisation. Empty reference → defined behaviour (WER = 0 if hypothesis also empty else `null` with a note), never a crash. Scores the RAW Scribe text only.
- **Intent accuracy** = correct / total × 100, overall and per language. Correct = normalised `intent` equals `expected_intent` or an alias; for negative cases correct = `clarification_required` matches `expected_clarification`.
- **Latency:** p50/p95 (nearest-rank, documented) for `system_latency_ms` and `wall_clock_ms`, with `n`; if n < 20 flag p95 as low-sample. Per-stage breakdown: scribe, fusion, TTS, other.
- **User effort:** mean `effort_actions` per successfully communicated message.
- **Ablation:** each scenario run twice — (A) `include_visual_cues=false`; (B) `true`. Report intent accuracy and effort for A and B side by side, overall and per group. No WER-improvement claim for gestures.
- `POST /eval/run` body `{mode:"mock"|"live"}`; `GET /eval/report` (JSON) and `GET /eval/report.csv`. Every report has `mode`, `generated_at`, `n_cases`, `n_skipped`; mock mode carries `"disclaimer":"mock results are not measurements"`.
- With no runs: report returns `{"status":"no_runs"}` — never zeros posing as results.

**Tests**
- M10-T01 WER: identical=0; one substitution; one deletion; one insertion (hand-computed expectations); mixed case; empty reference; Devanagari tokens.
- M10-T02 normalisation applied equally to both sides.
- M10-T03 intent accuracy arithmetic incl. aliases, per-language split, negative-case rule.
- M10-T04 p50/p95 on a known list (state the method; include n<20 flag).
- M10-T05 effort mean on a known list; excludes messages never confirmed.
- M10-T06 ablation yields two result sets with identical case ids; A has no cues in evidence, B has.
- M10-T07 mock-mode report labelled mock + disclaimer; live mode skips cases without audio and says so.
- M10-T08 `no_runs` state explicit.
- M10-T09 scenarios.json validates against its Pydantic schema; group counts meet the minimums; simulated cases flagged.
- M10-T10 CSV export has header + one row per case per arm.

---

## M11 — Hardening / Definition of Done  (blueprint §07 "Definition of done")

**Build** README (setup, `.env`, MediaPipe model downloads, run command, curl examples for the full loop, client contract notes: PCM16 16 kHz for Scribe WS, un-mirrored frames, preview-before-edit), CORS (configurable origins, default none), request size limits verified, request-id in logs, final cleanup of unused code. **No new features.**
Then ONE test file `tests/test_m11_definition_of_done.py` checking the blueprint's five items end-to-end (faked externals):
1. Both speaker turns captured and labelled; patient transcript + recent context visible.
2. Vision returns stable gesture and face/mouth features with timestamps.
3. LLM returns valid ranked candidates OR an explicit clarification request.
4. Patient can confirm / edit / reject; no unconfirmed reply is ever spoken (try to bypass: random id, rejected id, pending id).
5. TTS speaks the confirmed sentence; the turn log has language, reference transcript field, intent label and latency.

**Final report** must include: full `pytest -v` summary, `pytest -m live` summary (or "skipped: keys missing"), remaining risks (system vs wall-clock latency against the 2 s target; Hindi/code-mixed quality unproven until measured), a blueprint-compliance table (every "Mandatory requirement" row → where it is implemented/tested), and an explicit statement that §08 avatar was NOT built.

---

## M12 — Avatar (STRETCH, GATED — do not start)
Blueprint §08. Only if the user explicitly says so AFTER M11 passes. Never on the critical path.
