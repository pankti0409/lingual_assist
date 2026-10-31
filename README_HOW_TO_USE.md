# How to use this kit with Claude Code

## 1. Set up the project folder
```
ps16-assistant/
  CLAUDE.md                 <- auto-loaded by Claude Code every session
  PROGRESS.md               <- ledger Claude updates after every module
  KICKOFF_PROMPT.md         <- paste its prompt once
  docs/
    blueprint.md            <- your blueprint, extracted from the .docx
    MODULE_SPECS.md
    VERIFIED_API_NOTES.md
  assets/                   <- put the two MediaPipe .task files here before M4
  tests/data/               <- optional: a short real audio clip for the M3 live test
  .env                      <- your keys (create yourself; never paste keys into the chat)
```
`.env`
```
ELEVENLABS_API_KEY=your_key
GROQ_API_KEY=your_key
LLM_MODEL=openai/gpt-oss-120b
```

## 2. Start
```
cd ps16-assistant
git init            # optional but recommended: one commit per green module = easy rollback
claude              # start Claude Code in this folder
```
Paste the prompt from `KICKOFF_PROMPT.md`. Tip: press Shift+Tab to use Plan mode if you want to approve the M0 plan before any files are written.

## 3. The loop
1. Claude does ONE module, runs its tests + the full regression, prints a MODULE REPORT and stops.
2. You read the report (check: tests green, "Deviations: none", sensible Assumptions).
3. Reply `next`. Between modules, running `/clear` is safe — all rules are in CLAUDE.md and all state is in PROGRESS.md.

## 4. Things YOU must provide (Claude will stop and ask)
| When | What |
|---|---|
| Before M3 live test | `ELEVENLABS_API_KEY` in `.env` (+ optional short audio clip in `tests/data/`) |
| Before M4 | `face_landmarker.task` and `gesture_recognizer.task` in `assets/` (official MediaPipe guides, blueprint refs [2]–[4]) |
| Before M6 live test | `GROQ_API_KEY` |
| Before M8 | A voice: either a consented sample for cloning (paid ElevenLabs plan may be needed) or use Voice Design |
| Before M10 live mode | Your own consented, labelled recordings referenced by `evaluation/scenarios.json` |

## 5. Red flags to watch for in reports
- "Deviations from blueprint" is not "none" without a reason you accept.
- Tests were skipped/xfailed (only `live` and missing-model skips are allowed).
- A module touched files that belong to a later module.
- The invariant mutation check (M1, M7, M8) is missing.
- Numbers in M10 that came from mock mode presented as real results.
