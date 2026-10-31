# PS-16 Multimodal Live Conversation Assistant - backend

FastAPI backend for an assistive-communication proof of concept (people with speech impairments).
Pipeline: capture patient + partner turns, transcribe with ElevenLabs Scribe, extract face/hand cues with
MediaPipe, rank likely intended messages with a Groq LLM, let the **patient confirm**, then speak only the
confirmed message with ElevenLabs TTS.

> Scope: an assistive-communication prototype, not a diagnostic tool and not a clinically validated AAC device.
> The safety rules are summarised at the end of this file.

## Setup
Python 3.10 or 3.11.
```
python -m venv .venv
.venv\Scripts\activate            # Windows (use `source .venv/bin/activate` elsewhere)
pip install -r requirements.txt
copy .env.example .env            # then edit; never commit .env or paste keys into chat
```

### `.env`
```
ELEVENLABS_API_KEY=...        # Scribe (STT) + TTS + voices
GROQ_API_KEY=...              # intent fusion LLM
LLM_MODEL=openai/gpt-oss-120b
# optional
DEFAULT_VOICE_ID=             # an existing ElevenLabs voice id; used (and labelled "default_voice") if a session has none
CORS_ORIGINS=                 # comma-separated allowed origins; empty (default) = no CORS headers
LOGS_DIR=logs                 # turn log location (only written for sessions with demo_use consent)
```
Missing keys never crash startup: the feature that needs one returns `503 not_configured` when called.
All tunables (thresholds, windows, model ids) are in `config.py` and overridable by environment variable.

### MediaPipe models (needed for vision)
Install the two versioned model bundles published by Google and record their source URLs, sizes, and SHA-256 hashes:
```
python scripts/download_vision_models.py
```
The installer uses the official model URLs referenced by MediaPipe's GitHub documentation:
```
assets/face_landmarker.task        https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
assets/gesture_recognizer.task     https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task
```
The `.task` binaries stay untracked; `assets/models.json` is the reproducible provenance manifest.
Without them the vision endpoints return `503 not_configured` and the real-model test is skipped.
`GET /health` shows which services, models and assets are configured (booleans only, never key values).

## Run
```
uvicorn main:app --reload
```
Interactive docs: http://127.0.0.1:8000/docs

## The core loop (curl)
```
B=http://127.0.0.1:8000

# 1. session + consent (nothing is captured, cloned or logged without the matching consent)
SID=$(curl -s -X POST $B/sessions -H 'content-type: application/json' -d '{"language":"en"}' | python -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
curl -s -X POST $B/sessions/$SID/consent -H 'content-type: application/json' \
     -d '{"audio_recording":true,"face_capture":true,"demo_use":true}'

# 2. a voice for the session (designed voice shown; /voices/clone needs voice_cloning consent)
curl -s -X POST $B/voices/design -H 'content-type: application/json' \
     -d "{\"session_id\":\"$SID\",\"description\":\"A calm, warm adult voice\"}"

# 3. both speakers (batch upload; or type a turn with POST /sessions/$SID/turns/text)
curl -s -X POST $B/sessions/$SID/transcribe -F speaker=partner -F audio=@partner.wav
curl -s -X POST $B/sessions/$SID/transcribe -F speaker=patient -F audio=@patient.wav

# 4. (optional) camera frames: un-mirrored JPEG/PNG, ~5 per second
curl -s -X POST $B/sessions/$SID/vision/frame --data-binary @frame.jpg -H 'content-type: image/jpeg'

# 5. "finish speaking": evidence -> fusion -> a pending proposal
curl -s -X POST $B/sessions/$SID/turn/finish -H 'content-type: application/json' -d '{}'

# 6. the PATIENT decides: confirm, edit, reject or clarify
curl -s -X POST $B/sessions/$SID/proposals/$PID/confirm -H 'content-type: application/json' -d '{"candidate_index":0}'
#   .../edit {"text":"..."}   .../reject   .../clarify

# 7. only a confirmed message can be spoken
curl -s -X POST $B/sessions/$SID/speak -H 'content-type: application/json' -d "{\"confirmed_id\":\"$CID\"}" -o out.mp3
curl -s $B/sessions/$SID/metrics
```

## Endpoints
| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Sessions + consent | `POST /sessions`, `POST /sessions/{id}/consent`, `GET/DELETE /sessions/{id}` |
| Conversation | `GET /sessions/{id}/history`, `POST /sessions/{id}/turns/text` |
| Speech in | `POST /sessions/{id}/transcribe`, `WS /ws/sessions/{id}/scribe` |
| Vision | `POST /sessions/{id}/vision/frame`, `GET /sessions/{id}/vision/cues`, `PUT /sessions/{id}/gesture-map`, `WS /ws/sessions/{id}/vision` |
| Fusion | `POST /sessions/{id}/evidence`, `POST /sessions/{id}/fuse`, `POST /sessions/{id}/turn/finish` |
| Confirmation | `POST /sessions/{id}/proposals/{pid}/confirm\|edit\|reject\|clarify`, `GET /sessions/{id}/confirmed/{cid}` |
| Voice out | `POST /sessions/{id}/speak`, `GET /voices`, `POST /voices/clone`, `POST /voices/design` |
| Metrics / eval | `GET /sessions/{id}/metrics`, `POST /eval/run`, `GET /eval/report`, `GET /eval/report.csv` |

All errors use one shape: `{"error":{"code","message","request_id","details"}}` with codes `consent_required` (403),
`not_found` (404), `invalid_state` (409), `too_large` (413), `validation_error` (422), `upstream_error` (502),
`not_configured` (503). Every response carries `X-Request-ID`, and the same id appears in the server logs.

## Client contract notes
- **Realtime speech (`WS /ws/sessions/{id}/scribe`)**: send `{"type":"start","speaker":"patient|partner","language":"en|hi|mixed"}`,
  then binary frames of **PCM 16-bit, mono, 16 kHz** (no re-encoding is done server-side), `{"type":"commit"}` when the
  speaker finishes, `{"type":"stop"}` to close. Only `committed` text enters the conversation. Batch upload accepts the
  formats Scribe accepts (wav, mp3, m4a, flac, ogg, webm, ...).
- **Camera frames**: send **un-mirrored** frames. Mirroring swaps left/right blendshapes and handedness; the optional
  `mirrored` flag is only echoed back, never corrected for. Raw frames are never stored or logged.
- **Preview before edit**: show the patient the exact final text before submitting `/edit`; it is spoken verbatim.
- **Subtitles**: `/speak` returns `audio/mpeg`; the spoken text is in the percent-encoded `X-Subtitle-Text` header
  (UTF-8), first-audio latency in `X-First-Audio-Ms`, and `X-Voice-Persona` tells you whether the voice is
  `cloned_voice`, `designed_voice` (a substitute persona, never presented as a clone) or `default_voice`.
- **Limits**: frames `MAX_FRAME_BYTES` (2 MB), audio and voice samples `MAX_AUDIO_BYTES` (20 MB), typed text 1000 characters,
  edited replies 300 characters. Over the limit returns `413`/`422`.

## Test
```
pytest -v          # offline, fast, deterministic (all external services faked)
pytest -m live     # live tests; each skips with a reason when its key / file is missing
```
Live tests need: `ELEVENLABS_API_KEY` + a short clip in `tests/data/` (Scribe), `GROQ_API_KEY` (fusion),
`ELEVENLABS_API_KEY` + `DEFAULT_VOICE_ID` (TTS), and the two `.task` files (MediaPipe).

## Evaluation
`POST /eval/run {"mode":"mock"|"live"}`, then `GET /eval/report` or `/eval/report.csv`.
- **mock** uses injected transcripts and a rule-based stand-in for the LLM and TTS. Its output carries `"mode":"mock"`
  and a disclaimer and is **not a measurement**.
- **live** needs `ELEVENLABS_API_KEY` and `GROQ_API_KEY`, plus recordings: set `patient_audio_path` in
  `evaluation/scenarios.json` per case (cases without audio are reported as skipped). Only use recordings made with the
  speaker's recorded consent; label simulated atypical speech as simulated. Set `DEFAULT_VOICE_ID` to include the TTS leg
  of latency.
- Gesture and mouth cues in the scenarios are scripted, not measured from video. The patient is a simulated policy (see
  `patient_policy` in the report); human decision time is 0, so wall clock is about the system latency.
- Latency is reported as `system_latency_ms` (excludes human decision time) next to `wall_clock_ms`. The 2-second
  target must be checked against measured numbers on the demo machine; vendor latency figures are not system latency.

## Safety rules (enforced in code and tests)
Patient control (nothing is spoken before explicit confirmation), clarify instead of guess, evidence packets instead of
raw media, no diagnosis or emotion inference, no lip-reading claims, user-calibrated gestures, recorded consent for
recording / face capture / voice cloning / demo use, secrets only in `.env`, honest metrics. The optional avatar (blueprint
section 08) is **not** built.
