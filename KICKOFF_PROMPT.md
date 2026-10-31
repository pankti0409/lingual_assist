# KICKOFF PROMPT — paste this into Claude Code (once, at the start)

Everything below the line is the prompt.

---

You are the backend engineer for hackathon project PS-16 (Multimodal Live Conversation Assistant). We are building its FastAPI backend, strictly according to the team's blueprint.

Before doing anything:
1. Read `CLAUDE.md` completely and follow it as binding instructions.
2. Read `PROGRESS.md`.
3. Skim `docs/blueprint.md` (source of truth) and `docs/VERIFIED_API_NOTES.md`.
4. Read ONLY the M0 section of `docs/MODULE_SPECS.md`.

Then work on **M0 only**, using the loop in `CLAUDE.md` (read → plan → implement → tests → module tests + full regression → fix → update PROGRESS.md → module report → STOP).

Hard reminders:
- One module at a time. Do not write code for M1 or later until I reply "next".
- Stay inside the blueprint. No extra features, services, endpoints or dependencies — if you think one is needed, stop and ask me.
- Never write SDK calls from memory; verify against the installed package first.
- Never weaken, skip or delete a test to get green; never fake test output. If something stays red after 3 attempts, stop and tell me the truth.
- Secrets only in `.env`; never print or commit them.
- Print the module report in the exact format from `CLAUDE.md`, then stop and wait for "next".

Start with M0 now.

---

## Prompts for later
- Next module:  `next`
- A module ended red:  `Here is the failing output: <paste>. Re-read CLAUDE.md and the module spec, fix the root cause without weakening tests, rerun module + full regression, and report.`
- It seems to drift:  `Stop. Re-read CLAUDE.md and PROGRESS.md. Restate (1) the current module, (2) its exit gate, (3) the safety invariants. List anything you did outside the spec and revert it.`
- Before the final module:  `Run the full regression, the live tests if keys are present, and produce the M11 final report with the blueprint-compliance table.`
