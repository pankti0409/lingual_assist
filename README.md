# PS-16 Multimodal Live Conversation Assistant - backend

FastAPI backend for an assistive-communication hackathon project. See `CLAUDE.md`, `docs/` and `PROGRESS.md`.

## Setup
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env    # then fill in keys (never commit .env)
```

## Run
```
uvicorn main:app --reload
```
`GET /health` reports which services, models and assets are configured.

## Test
```
pytest -v          # offline
pytest -m live     # live tests (need keys)
```

## Vision notes
- Send **un-mirrored** frames. Mirroring swaps left/right blendshapes and handedness; the optional `mirrored` flag is only echoed back, never corrected for.
- Put `face_landmarker.task` and `gesture_recognizer.task` (official MediaPipe models) in `assets/`. Without them vision endpoints return `503 not_configured`.
- Raw frames are never stored or logged; only derived cues are kept.

## Patient confirmation
Nothing is spoken until the patient confirms a proposal (`/confirm`) or submits their own text (`/edit`). Clients should show a preview of the exact final text before submitting an edit. `reject` and `clarify` are first-class actions; after either, call `/fuse` again for the same turn.
