# Lingual Assist — frontend

React + TypeScript + Vite web app for Lingual Assist, a multimodal conversation assistant for people with speech
impairments. **Patient control is the central rule: nothing is spoken until the patient confirms the exact words.**

Stack: React 19, TypeScript, Vite, TanStack Router (typed, code-split routes), TanStack Query, Motion, Lucide icons,
a token-based global stylesheet. Tests: Vitest + Testing Library.

## Run

```
npm install
npm run dev            # http://localhost:5173 (mock services by default)
npm test               # route, consent and confirmation-rule tests
npm run typecheck
npm run build
npm run check:layout   # headless Chrome: every route at 390/768/1024/1440/1920 px — overflow, console errors, failed requests
node tools/walkthrough.mjs <dir>   # headless Chrome: drives sample → confirm → play, expressions, voice, progress; saves screenshots
npm run media          # re-render all illustrations, posters and hero videos (needs Chrome + ffmpeg)
```

### Mock vs. real backend
Mock mode is the default and is labelled on every app screen (“Prototype mode”). Nothing is recorded, uploaded or stored,
and every scripted value is tagged as simulated or illustrative.

To use the FastAPI backend in the parent folder:

```
VITE_API_MODE=http VITE_API_BASE=http://127.0.0.1:8000 npm run dev
```

The backend needs `CORS_ORIGINS=http://localhost:5173`. No API keys ever reach the browser. In HTTP mode, speech is sent as one
recording when you press “Finish speaking”. Partial transcripts need the realtime PCM16 stream, which this build
doesn’t use. The camera preview stays on the device, and frames are not uploaded in this build.

## Structure

```
src/
  api/          contracts.ts (service interfaces), types.ts, mock/ (in-memory backend + scenarios), http/ (FastAPI adapter)
  state/        session store (temporary, in memory), session actions, playback, quick-say (expressions go through
                the normal confirm pipeline), device-local preferences, and the optional progress/badges store
  router.tsx    typed route tree: / /conversation /expressions /voice /journey /settings /gestures /setup /review
                /evaluation /screens (+ not found)
  shell/        app shell, skip link, navigation, connection banner, loading / error / not-found states
  pages/        one folder or file per route; conversation/ holds the main screen
  components/   Button, Dialog (focus trap), fields, ConsentSwitch, status, transcript
  art/          original illustration system (React SVG): Person, cast, HeroFilm (storyboard as a function of time), scenes
  lib/          motion constants, playback, device checks, DOM helpers
  styles/       tokens.css ("Playful Serenity" palette, type, motion, preference hooks), global.css (base, primitives,
                shell), pages.css (screens), companion.css (home, progress, favourites, signals)
tools/          render-media.mjs, check-layout.mjs, render page for headless capture
art-source/     exported SVG source of every still
public/media/   WebP + AVIF stills and posters, hero MP4/WebM (16:9 and 4:5), captions
```

## Rules enforced in code and tests
- Each of the four consents is a separate switch, starts off for every new session, and applies to that session only.
- Typed-only communication works with no microphone, camera or consent.
- The speaker is always chosen explicitly. Partial transcripts are shown as “still listening (not saved)” and never become turns.
- Gestures and visual cues are only sent as evidence. No code path lets a cue confirm a message or trigger speech.
- Candidate and edited replies are shown as exact text before confirming. Hindi and mixed text are kept byte-for-byte.
- Playback only uses the id of a confirmed message, never starts automatically, and is unavailable for pending, rejected or
  clarification proposals.
- Drafts survive errors and disconnection. Deleting a session clears all its temporary state.
- Mock evaluation results always show “Illustrative mock results — not measurements.” No claim is made that gestures
  improve transcription WER.

## Media
All characters and scenes are original vector artwork in `src/art`, drawn with the supplied palette. The hero video is the
same storyboard rendered frame by frame (16 s, 24 fps, seamless loop, no audio) at 1600×900 and 800×1000. Posters show
first, and the video loads afterwards, only when motion is allowed. Under reduced motion only the poster is used, and the
scroll story becomes a plain vertical sequence of stills.

## Personal preferences and progress
Text size, button size, contrast, motion, simplified mode, favourites, custom expressions and voice playback settings are
saved only in this browser (localStorage) and never sent to the service. Progress steps and badges are optional, are earned
only from real actions, store event names and dates only (never message text), and record nothing while switched off.
Speed and volume apply to every playback mode; pitch is offered only where the engine that speaks messages supports it.
