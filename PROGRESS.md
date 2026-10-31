# PROGRESS LEDGER — PS-16 FastAPI backend

Claude Code: read this FIRST every session. Update it at the end of every module. Never mark a module Done unless its exit gate is fully true and `pytest -v` (full regression) is green.

Status values: Not started · In progress · Done · Blocked

| Module | Name | Status | Tests (module / regression) | Commit | Notes |
|---|---|---|---|---|---|
| M0 | Foundation | Done | 10/10 / 10/10 | M0: Foundation | Added internal_error (500) code for unhandled exceptions |
| M1 | Consent + Sessions | Done | 12/12 / 22/22 | M1: Consent + Sessions | I8 mutation checked |
| M2 | Conversation State | Done | 13/13 / 35/35 | M2: Conversation State | |
| M3 | Speech Input (Scribe) | Not started | | | |
| M4 | Vision (MediaPipe) | Not started | | | |
| M5 | Evidence Packet | Not started | | | |
| M6 | Intent Fusion (Groq) | Not started | | | |
| M7 | Human Confirmation | Not started | | | |
| M8 | Voice Output (TTS) | Not started | | | |
| M9 | Orchestrator + E2E | Not started | | | |
| M10 | Evaluation | Not started | | | |
| M11 | Hardening / DoD | Not started | | | |
| M12 | Avatar (stretch, gated) | DO NOT START | | | Only if the user explicitly asks after M11 |

## Current module
M2 done; waiting for user to say "next" (M3).

## Decisions log (append; newest last)
- M0: kit files copied into repo root (project = this folder, not ps16-assistant/). Venv at .venv.

## Assumptions log (append; copied from module reports)
- M0: unhandled exceptions return 500 `internal_error` in the standard shape (not in the CLAUDE.md code list).
- M0: HISTORY_WINDOW_TURNS outside 4-6 is a startup error.
- M0: X-Request-ID from client accepted only if [A-Za-z0-9._-]{1,64}, else regenerated.

- M1: POST /sessions returns 201; DELETE returns 204. Consent response adds recorded_ms (session clock) and recorded_at (UTC ISO). Cleanup hooks are sync callables; a failing hook is logged and does not block deletion.
- M2: render_context excludes the given turn BEFORE trimming so the window stays full. Typed text is stripped and capped at 1000 chars (422). GET /history limit is 1-200, default = window. Turn timestamps are clamped to never decrease.

## Open questions for the user
- (empty)

## Environment facts (fill in during M0)
- Python version: 3.10.11
- OS: Windows 11
- MediaPipe model files present: face_landmarker.task ☐  gesture_recognizer.task ☐
- Keys present in .env (yes/no only, never values): ELEVENLABS ☐  GROQ ☐
