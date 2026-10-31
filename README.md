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
