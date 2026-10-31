# VERIFIED API NOTES (checked 31 Oct 2026)

These notes reduce guessing. They are NOT a substitute for introspecting the installed SDK:
before writing an adapter, run `pip show <pkg>`, then `python -c "import <pkg>; help(<pkg>.<thing>)"`
and confirm the names below exist. If anything differs → STOP and report (CLAUDE.md "Never write SDK code from memory").

Sources: ElevenLabs docs (elevenlabs.io/docs), the official ElevenLabs Python SDK README (PyPI / GitHub), Groq docs (console.groq.com/docs), Google AI Edge MediaPipe docs (ai.google.dev/edge/mediapipe). Where a fact came from a secondary mirror it is marked ⚠ — re-check on the official page.

---

## ElevenLabs Python SDK (`pip install elevenlabs`)
- Pin a STABLE release (check `pip index versions elevenlabs`). A pre-release (e.g. a `3.0.0a*`) exists — do NOT install pre-releases.
- Sync client `ElevenLabs`, async client `AsyncElevenLabs` (`from elevenlabs.client import ElevenLabs, AsyncElevenLabs`). Reads `ELEVENLABS_API_KEY`; pass `api_key=` explicitly from settings anyway.

### Speech-to-text, batch (build first)
- `client.speech_to_text.convert(file=<binary file>, model_id="scribe_v2", language_code=<optional>)`.
- `language_code` accepts ISO 639-1 or 639-3 (`"eng"`, `"hin"`); omit it for automatic detection — use omission for code-mixed input. ⚠ verify `hin` vs `hi` on the official page.
- Response has `.text`, `.language_code`, `.language_probability`, and word-level `.words` when requested (`timestamps_granularity="word"`).
- Accepts common audio/video container formats directly (mp3, wav, m4a, flac, ogg, webm, …) — no re-encoding needed for batch.
- Errors seen: 401 bad key, 422 bad params, 429 rate limit → map to `502 upstream_error` (401 → also log "check ELEVENLABS_API_KEY" without printing the key).

### Speech-to-text, realtime WebSocket (build second)
- Model `scribe_v2_realtime`. Official guide: elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/server-side-streaming
- SDK pattern (verify exact names in the installed SDK):
  `connection = await elevenlabs.speech_to_text.realtime.connect(RealtimeAudioOptions(model_id="scribe_v2_realtime", audio_format=AudioFormat.PCM_16000, sample_rate=16000, commit_strategy=CommitStrategy.MANUAL, ...))`
  Imports used in the guide: `from elevenlabs import ElevenLabs, AudioFormat, CommitStrategy, RealtimeEvents, RealtimeAudioOptions`.
- Events: `RealtimeEvents.PARTIAL_TRANSCRIPT`, `RealtimeEvents.COMMITTED_TRANSCRIPT` (`data["text"]`), `RealtimeEvents.ERROR`, `SESSION_STARTED`, and a with-timestamps variant only when `include_timestamps=True`.
- Commit strategies: manual (client decides when a segment ends — matches the blueprint's user-triggered "finish speaking") or VAD (auto-commit on silence). Use MANUAL for the patient.
- Audio must match the declared format: PCM 16-bit mono 16 kHz for `PCM_16000`. The guide's file example uses pydub to convert — we do NOT add pydub; our WS contract requires clients to send PCM16 16 kHz.
- The API-key (server-side) path is used; single-use tokens are for client-side streaming only.

### Text-to-speech
- `client.text_to_speech.convert(text=..., voice_id=..., model_id="eleven_flash_v2_5", output_format="mp3_44100_128")` returns an iterator of audio bytes.
- `client.text_to_speech.stream(text=..., voice_id=..., model_id=...)` yields chunks as they are generated — use it to measure time-to-first-byte (start timer at the call, stop at the first non-empty chunk).
- `eleven_flash_v2_5`: ultra-low latency, 32 languages. Hindi/code-mixed pronunciation quality must be tested, not assumed (blueprint §04-E).

### Voices
- List: `client.voices.search()` → `.voices` ⚠ (older SDKs used `voices.get_all()`; use whatever the installed SDK has).
- Instant Voice Cloning: `client.voices.ivc.create(name="...", description="...", files=[<file objects or paths>])` → returns an object with the new `voice_id`. Typically needs a paid plan and ElevenLabs may require consent/verification — surface provider errors as `502`, not a crash.
- Voice Design (text-description voices): ⚠ NOT verified here. Find the method in the installed SDK (look under `text_to_voice` / `voices`), read the official voice-design docs, and report the exact call before using it.

---

## Groq (`pip install groq`)
- Client: `from groq import Groq` / `AsyncGroq`; `client.chat.completions.create(...)` (OpenAI-compatible). Key from `GROQ_API_KEY`.
- Model id: `openai/gpt-oss-120b` (listed on console.groq.com/docs/models). Confirm it is still listed at build time.
- **Structured outputs:** `response_format={"type":"json_schema","json_schema":{"name":"fusion_result","strict":True,"schema": FusionResult.model_json_schema()}}`. Groq's docs list `openai/gpt-oss-120b` as supported. BUT a Groq community report (Oct 2025) said the schema was ignored on 120b — so ALWAYS re-validate with Pydantic and keep the retry-once path regardless of provider enforcement.
- Strict mode requires schemas to follow Groq's restrictions (e.g. all properties required, `additionalProperties:false`). If strict rejects the Pydantic-generated schema, simplify the schema or fall back to `strict:false`, and report which you used.
- **Reasoning:** `reasoning_effort` accepts `"low" | "medium" | "high"` for gpt-oss models. Use `"low"` for latency. Reasoning tokens count toward the completion budget — set `max_completion_tokens` (Groq's name) high enough (default here 1024) or JSON can be truncated. Treat truncation as malformed output → retry once → clarify.
- Do not request or display reasoning content to the user; the patient-facing field is `reasoning_summary` from the JSON only.
- Rate limits/timeouts: wrap with `LLM_TIMEOUT_S`; map provider errors to `502`.

---

## MediaPipe Tasks (Python) — `pip install mediapipe`, Python 3.10/3.11
Imports: `import mediapipe as mp`, `from mediapipe.tasks import python`, `from mediapipe.tasks.python import vision`.
Model files (`face_landmarker.task`, `gesture_recognizer.task`): downloaded by the user from the official guides (blueprint refs [2], [3], [4]) into `assets/`.

### Common
- `mp.Image(image_format=mp.ImageFormat.SRGB, data=<numpy HxWx3 uint8>)` — SRGB means **RGB order**. OpenCV decodes BGR → convert first with `cv2.cvtColor(img, cv2.COLOR_BGR2RGB)`. Forgetting this silently degrades detection.
- Running modes: `IMAGE` (blocking, one image), `VIDEO` (blocking, needs timestamps), `LIVE_STREAM` (async, returns immediately, results via `result_callback`).
- `LIVE_STREAM`: call `landmarker.detect_async(mp_image, timestamp_ms)`; timestamps must be monotonically increasing; if the task is busy it ignores the new frame; results arrive on a callback thread `(result, output_image, timestamp_ms)`. Therefore: keep one task object per session, store the latest result in a thread-safe slot, and never reuse a timestamp.
- Use the task as a context manager / `close()` it when the session ends.

### FaceLandmarker
- Options: `FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=...), running_mode=..., num_faces=1, output_face_blendshapes=True, output_facial_transformation_matrixes=True, result_callback=...)`.
- Result: `result.face_landmarks` (478 landmarks), `result.face_blendshapes[0]` → list of categories with `.category_name` and `.score` (52 blendshapes, e.g. `jawOpen`, `mouthClose`, `mouthFunnel`, `mouthStretchLeft`, `mouthStretchRight`, `eyeBlinkLeft`, …), `result.facial_transformation_matrixes[0]` → 4×4 matrix.
- `*Left` / `*Right` blendshapes refer to the subject's face; a horizontally mirrored input inverts them.
- Blueprint limits that apply: no emotion inference, no word-level lip reading; mouth/jaw activity and head movement only.

### GestureRecognizer
- Options: `GestureRecognizerOptions(base_options=..., running_mode=..., num_hands=1, result_callback=...)`.
- Result: `result.gestures[hand][0]` → category with `.category_name` and `.score`; `result.handedness`; `result.hand_landmarks`.
- Built-in labels: `Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou, None`. `Pointing_Up` is NOT generic object pointing.

---

## FastAPI/pytest practicalities (frequent agent mistakes)
- `UploadFile` / multipart needs `python-multipart`.
- WebSocket tests: `with client.websocket_connect(...) as ws:`; use fakes injected via `app.dependency_overrides` (for WS use a dependency function, not a global).
- Sync SDK calls inside `async def` handlers block the loop → use async clients or `anyio.to_thread.run_sync`.
- `pytest-asyncio`: set `asyncio_mode = auto` in `pytest.ini`.
- Return audio with `StreamingResponse(..., media_type="audio/mpeg")`. Headers go out BEFORE the body, so to send `X-First-Audio-Ms` you must pull the first audio chunk from the iterator first, measure the time, then build the response with that header and a generator that yields the first chunk followed by the rest. Always record the value in the session metrics too.
