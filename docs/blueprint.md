**PS-16  /  MULTIMODAL COMMUNICATION ASSISTANT**

**HACKATHON TECHNICAL BLUEPRINT  /  PS-16**

**Multimodal Live**
**Conversation Assistant**

A practical 12-hour build plan for people with speech impairments

| **12 HOURS** core prototype | **MULTIMODAL** audio + vision + context | **AVATAR LATER** optional 2D / 3D layer |
| --- | --- | --- |

| **THE BUILD IN ONE SENTENCE** Capture the patient and conversation partner, transcribe speech with ElevenLabs, extract face and hand cues with MediaPipe, use a context-aware LLM to rank likely intended messages, ask the patient to confirm, and speak the confirmed message with ElevenLabs. |
| --- |

## What this document is for

This is an implementation blueprint, not a clinical product specification. It translates the supplied PS-16 brief into a buildable prototype, identifies what is genuinely open source versus hosted API services, and places avatar generation at the end as a stretch feature.

## Recommended build order

| **PRIORITY** | **BUILD** | **DONE MEANS** |
| --- | --- | --- |
| **1  CORE** | Speech + camera + gesture/face cues + context fusion | A confirmed sentence is generated from multimodal inputs. |
| **2  OUTPUT** | ElevenLabs personalised TTS | The confirmed sentence is spoken and played back. |
| **3  VALIDATE** | Test scenarios and latency/accuracy metrics | The team can show measured results, not invented claims. |
| **4  OPTIONAL** | 2D or 3D speaking avatar | Only begin after priorities 1-3 work end-to-end. |

| **NON-NEGOTIABLE DESIGN RULE** The AI may suggest meaning; the patient controls the message. Never speak a guessed response without confirmation. When cues conflict or confidence is insufficient, ask the patient to clarify. |
| --- |

*Prepared from the supplied Acropolis Institute PS-16 PDF and checked against official project/documentation sources on 31 October 2026.*

**01  /  PROBLEM STATEMENT**

# What PS-16 is asking you to build

Source basis: Problem Statement 16, page 1 of the supplied PDF.

| **PROBLEM STATEMENT - FAITHFUL SUMMARY** People with speech impairments associated with ALS, cerebral palsy, Parkinson's disease, stroke or laryngectomy can struggle in live conversation. Standard speech recognition may fail on atypical speech, while voice-only tools ignore gestures, facial expressions and lip movements. Build a real-time assistant that combines these signals with the other speaker's conversation, infers the patient's intended message, suggests replies and speaks only the confirmed message in a natural, personalised voice. |
| --- |

**Domain:** AI for Biomedical Engineering and Assistive Technology.

## Mandatory requirements from the brief

| **REQUIREMENT** | **WHAT THE PROTOTYPE MUST SHOW** |
| --- | --- |
| Patient speech | Transcribe atypical / imperfect speech using ElevenLabs Scribe. Capture partial and final transcript where possible. |
| Other speaker | Understand what the conversation partner said and retain recent conversational context. |
| Visual cues | Use camera input for hand gestures, facial movement and mouth/lip landmarks. |
| Multimodal fusion | Combine transcript + visual cues + context; rank candidate intents with an LLM. |
| Response suggestions | Offer concise, context-aware candidate replies for the patient to choose / edit / reject. |
| Personalised output | Use ElevenLabs speech generation; use a consented voice clone or a clearly disclosed designed voice. |
| Language | Demonstrate English, Hindi and code-mixed input to the extent supported by the selected models; test separately. |
| Consent | Obtain explicit permission for any voice recording, cloning, face capture and demo use. |

## Evaluation explicitly requested by PS-16

| **METRIC** | **HOW TO MEASURE** |
| --- | --- |
| Word Error Rate (WER) | Compare the speech transcript with a manually verified reference transcript. |
| Intent accuracy | Correctly inferred intents divided by total labelled test scenarios. |
| End-to-end latency | Time from the end of an input turn to the first audible generated output. PS target: under 2 seconds. |
| User effort | Number of confirmations, corrections or selections needed to complete one message. |

| **SCOPE BOUNDARY** This is an assistive communication proof of concept, not a diagnostic tool and not a clinically validated replacement for AAC devices. A 12-hour demo should use consenting volunteers and clearly label simulated atypical speech. |
| --- |

**02  /  TECHNOLOGY STACK**

# Use this stack - keep the first build simple

The PS mandates ElevenLabs. The camera, UI, orchestration and data validation can use open-source tools.

| **LEGEND** OPEN SOURCE = self-hostable library / project. REQUIRED HOSTED SERVICE = PS-mandated or API-based service; it is not open source. OPTIONAL = only add after the core works. |
| --- |

| **LAYER** | **RECOMMENDED TOOL** | **ROLE / EXACT COMPONENT** |
| --- | --- | --- |
| **UI** | Gradio (Python) | Fast hackathon UI: microphone input, webcam/image input, transcript display, candidate reply buttons and audio playback. |
| **Camera / frames** | OpenCV (`cv2`) | Capture webcam frames, resize/convert frames and timestamp them before vision inference. |
| **Face / lips** | MediaPipe Tasks - `FaceLandmarker` | Face mesh landmarks, facial blendshape scores and transformation matrix. Use mouth/jaw activity as a cue; not word-level lip-reading. |
| **Hands / gestures** | MediaPipe Tasks - `GestureRecognizer` | Recognise built-in hand gestures and return hand landmarks / handedness. |
| **Speech input** | ElevenLabs Scribe v2 Realtime (`scribe_v2_realtime`) | Mandatory hosted WebSocket speech-to-text. Gives partial and committed transcript events. |
| **Speech output** | ElevenLabs Flash v2.5 (`eleven_flash_v2_5`) | Mandatory hosted text-to-speech; low-latency voice output. Confirm Hindi / English / code-mix quality with actual tests. |
| **Voice identity** | ElevenLabs Instant Voice Cloning or Voice Design | Use only with explicit consent. A designed voice is a substitute persona, not an exact clone of the patient. |
| **Intent reasoning** | Groq SDK + `openai/gpt-oss-120b` (hosted inference) | Convert transcript, context and visual cues into structured ranked candidate intents. The SDK is a client library; the API is hosted. |
| **Schema / config** | Pydantic + `python-dotenv` | Validate JSON outputs and load API keys/configuration from `.env`. |
| **Audio / arrays** | NumPy + Python standard library | Audio/frame buffers, timestamps, basic signal and data handling. |

## What is actually open source?

| **OPEN-SOURCE / LOCAL** | **HOSTED / NOT OPEN SOURCE** |
| --- | --- |
| Gradio, OpenCV, MediaPipe, Pydantic, NumPy, python-dotenv. | ElevenLabs Scribe, ElevenLabs TTS, ElevenLabs voice services. |
| Optional research: Auto-AVSR (Apache-2.0 code); MuseTalk (MIT code); TalkingHead (MIT code). | Groq inference endpoint. `gpt-oss-120b` is an open-weight model, but the hosted inference service is not self-hosting. |

| **RECOMMENDATION** Do not add React + FastAPI + a database just to make the 12-hour demo look larger. Use Gradio + Python functions first. If the core is stable, move the UI to React and expose the Python pipeline through FastAPI later. |
| --- |

**03  /  BASIC PIPELINE**

# End-to-end architecture

Build and test this exact flow before touching avatar generation.

| **01  INPUTS** Patient microphone + conversation partner audio. Webcam captures face and hands. | **02  AUDIO TRANSCRIPTION** ElevenLabs Scribe v2 Realtime streams partial and committed transcript segments. |
| --- | --- |
| **03  VISUAL FEATURES** OpenCV supplies frames; MediaPipe extracts face blendshapes, mouth activity and hand gesture labels. | **04  TIME-ALIGNED CONTEXT** Attach speaker role, timestamps, recent dialogue and visual cue confidence to one session state. |
| **05  INTENT FUSION** LLM ranks likely intent and produces 2-3 concise candidate replies in strict JSON. | **06  HUMAN CONFIRMATION** Patient confirms, edits, rejects or asks for clarification. No automatic speaking. |
| **07  SPEECH OUTPUT** ElevenLabs generates audio in the selected voice; app plays audio and shows subtitles. |

## Two parallel streams - one fusion point

| **AUDIO STREAM** | **VISION STREAM** |
| --- | --- |
| Patient speech -> Scribe transcript + timestamp. | Camera frames -> face / hand landmarks + cue + timestamp. |
| Conversation partner -> transcript + speaker role. | Keep only compact derived features; do not send raw video to the LLM. |
| Maintain a short rolling dialogue history (e.g., last 4-6 turns). | Sample a few frames per second for the prototype; use latest stable cue at the patient turn. |

| **IMPORTANT MULTIMODAL LIMIT** MediaPipe detects facial and hand landmarks; it does not decode spoken words from lip shapes. The basic version may derive mouth-open / mouth-active indicators and head movement from landmarks. True visual speech recognition is a separate, heavier model and is a later upgrade. |
| --- |

**04  /  COMPONENT SPECIFICATION**

# What each component does - and does not do

## A. Speech input - ElevenLabs Scribe v2 Realtime

Model ID: `scribe_v2_realtime`. Use the real-time WebSocket API for partial transcript events while speech is arriving and committed segments when an utterance is complete.

For a simpler first integration, use completed audio segments with Scribe v2 batch transcription; switch to the realtime socket after the baseline is stable.

The PS requires transcription of both participants. In a 12-hour demo, use a visible speaker toggle / separate turn capture to label PATIENT vs PARTNER. Add automated diarization only after testing; do not assume perfect speaker separation.

Official implementation guide: ElevenLabs server-side streaming [5].

## B. Face and mouth cues - MediaPipe FaceLandmarker

Use `mediapipe.tasks.python.vision.FaceLandmarker` in `LIVE_STREAM` mode; enable face blendshapes and facial transformation matrix output.

The current Face Landmarker model bundle estimates 478 3D face landmarks and 52 blendshape scores. Useful signals include `jawOpen`, `mouthClose`, mouth stretch / funnel and eye blink scores [2].

Compute a simple `mouth_activity` feature from jaw / lip blendshape movement over a short time window. Track head movement using landmarks or the transformation matrix.

Do not infer a precise emotion or sentence from a single face frame. These values are visual movement cues, not a reliable measure of internal emotion or intent.

## C. Hand gestures - MediaPipe GestureRecognizer

Use `mediapipe.tasks.python.vision.GestureRecognizer` in `LIVE_STREAM` mode; it returns gesture categories, handedness and hand landmarks [3, 4].

Built-in categories: `Closed_Fist`, `Open_Palm`, `Pointing_Up`, `Thumb_Down`, `Thumb_Up`, `Victory`, `ILoveYou` and `None` [4].

Create a user-calibrated mapping. Example for a demo only: Thumb_Up = yes/confirm; Open_Palm = pause; Thumb_Down = no/reject. Never assume a gesture has the same meaning for every person.

| **POINTING TO AN OBJECT IS NOT A BUILT-IN LABEL** The canned label `Pointing_Up` is not generic object pointing. To point at an object, calculate the index-finger direction from hand landmarks and intersect it with screen regions / an object detector. Keep this out of the minimum viable build. |
| --- |

## D. LLM fusion - Groq + open-weight model

Send compact structured inputs: transcript, speaker role, recent dialogue, gesture label / score, mouth activity, timestamp and user language preference.

Ask the LLM to rank candidate meanings, return 2-3 replies and state whether clarification is required. Validate the response with Pydantic before showing it.

Use one short prompt and low output limit. Do not ask the LLM to diagnose a condition, infer emotion or invent facts. A model-reported confidence value is not calibrated probability.

## E. Voice output - ElevenLabs

Use `eleven_flash_v2_5` for fast TTS; use the consented `voice_id` when authorised. Stream audio if supported by the selected endpoint/client.

The PS asks for English, Hindi and code-mixed speech. Scribe supports broad language coverage and Flash v2.5 supports 32 languages; test Hindi and code-switching on actual examples before claiming support [6].

**05  /  FUSION LOGIC**

# Give the LLM evidence, not raw media

The LLM should not receive a live video stream. Convert each modality into a small, timestamped feature packet and keep the last few conversation turns in session state.

## Suggested evidence packet

| {   "speaker": "patient",   "transcript": "wa... water",   "language": "en",   "timestamp_ms": 12400,   "conversation_context": [     {"speaker": "partner", "text": "Water or tea?"}   ],   "visual_cues": {     "gesture": {"label": "Thumb_Up", "score": 0.91},     "mouth_activity": true,     "head_nod": false   } } |
| --- |

## Required structured response

| {   "intent": "request_water",   "candidate_replies": [     "I would like water, please.",     "Could I have some water?"   ],   "clarification_required": false,   "reasoning_summary": "Transcript and recent question align." } |
| --- |

The response schema is an implementation contract, not a mandated PS format. Validate types and allowed fields with Pydantic; reject malformed output and retry once or present a clarification prompt.

## Fusion logic - simple and safe

Wait for a stable / committed patient speech segment, or a user-triggered “finish speaking” action.

Collect the latest stable gesture and face cues from the same short time window. Ignore stale cues or cues with low detector scores.

Load the last 4-6 dialogue turns and identify which speaker said each line.

Ask the LLM for 2-3 candidate interpretations. Require it to use only supplied evidence and to flag ambiguity.

Show the candidates as large, accessible buttons. Let the patient select, edit, reject or ask again.

Only after confirmation, send the exact chosen text to ElevenLabs TTS and play it.

## Example: ambiguous speech + contextual cue

| **INPUT EVIDENCE** | **SYSTEM INTERPRETATION** |
| --- | --- |
| Partner: “Would you like water or tea?” Patient transcript: “wa... water”. Gesture: calibrated point / yes cue toward water. | Likely intent: request water. Suggested responses: “I would like water, please.” / “Could I have some water?” |
| Patient transcript unclear; face cue conflicts with gesture; no clear conversation context. | Do not guess. Show “I did not understand - please choose, repeat or clarify.” |

| **PATIENT CONTROL IS A CORE FEATURE** The model may rank possible intents, but a patient confirmation is required before audio is generated. “No”, “edit” and “clarify” must be first-class actions, not hidden fallbacks. |
| --- |

**06  /  12-HOUR EXECUTION**

# Build the core in this order

| **TIME** | **TASK** | **EXIT CHECK** |
| --- | --- | --- |
| 00:00-01:00 | Create Python environment, `.env`, Gradio shell and test ElevenLabs API key. | UI opens; one test transcription or TTS call works. |
| 01:00-02:30 | Integrate Scribe (batch first if realtime socket setup slows you down). Add patient/partner speaker selector. | Two labelled transcripts appear. |
| 02:30-04:00 | Connect webcam with OpenCV; add MediaPipe FaceLandmarker and GestureRecognizer. | Live face / hand landmarks and stable gesture labels appear. |
| 04:00-05:00 | Convert face/hand outputs into timestamped compact cue packets. | JSON feature packet prints for each test turn. |
| 05:00-07:00 | Add Groq LLM call, conversation history and Pydantic response schema. | Candidate intents and replies render reliably. |
| 07:00-08:00 | Add confirmation, edit, reject and clarification controls. | No audio plays before confirmation. |
| 08:00-09:00 | Connect ElevenLabs Flash v2.5 TTS; play and subtitle confirmed output. | The complete core loop works. |
| 09:00-10:30 | Run scripted English, Hindi and code-mixed scenarios; compare audio-only vs fused. | WER, intent accuracy and latency log exists. |
| 10:30-12:00 | Fix critical bugs, prepare demo data, screenshot / record demo and presentation. | Repeatable demo with measured results. |

## Suggested project structure

| ps16-assistant/   app.py                  # Gradio UI + event wiring   config.py               # environment settings   schemas.py              # Pydantic input/output models   services/     scribe.py             # ElevenLabs Scribe adapter     vision.py             # OpenCV + MediaPipe features     fusion.py              # LLM prompt + candidate ranking     tts.py                 # ElevenLabs TTS adapter   state/     conversation.py       # speaker-labelled rolling history   evaluation/     scenarios.json        # labelled test cases     metrics.py            # WER / intent / latency calculations   assets/                 # local MediaPipe task model files   .env.example   requirements.txt |
| --- |

## Environment setup

| python -m venv .venv # activate the environment, then: python -m pip install --upgrade pip pip install gradio opencv-python mediapipe numpy pydantic \             elevenlabs groq python-dotenv  # .env (never commit this file) ELEVENLABS_API_KEY=your_key GROQ_API_KEY=your_key LLM_MODEL=openai/gpt-oss-120b |
| --- |

Use Python 3.10 or 3.11 for a predictable hackathon environment. Install MediaPipe Tasks and download the matching `.task` model bundles using the official guide. Test webcam access and API connectivity before implementing the full UI.

**07  /  TESTING ****&**** ACCEPTANCE**

# Prove that multimodal fusion helps

## Minimum evaluation set

| **TEST GROUP** | **SAMPLE CASES** | **WHAT TO CHECK** |
| --- | --- | --- |
| Clear speech | 5 ordinary clear sentences. | Baseline ASR quality and normal response path. |
| Atypical / simulated speech | 5 deliberately reduced, slurred or incomplete utterances by a consenting volunteer. Clearly label as simulated. | How often ASR fails; whether context and cues recover intended meaning. |
| Gesture support | 5 cases with a calibrated gesture paired with ambiguous speech. | Audio-only vs audio + gesture intent accuracy. |
| Conversation context | 5 questions / answers with two speaker turns. | Whether the system understands who said what and uses recent context. |
| Language | English, Hindi and code-mixed examples. | Transcription, LLM interpretation and TTS pronunciation separately. |
| Negative / ambiguous | Conflicting cues, no visible gesture, background noise, no speech. | The system asks for clarification rather than hallucinating a reply. |

## Metrics and exact calculation

| **METRIC** | **MEASUREMENT** |
| --- | --- |
| WER | (Substitutions + Deletions + Insertions) / Reference words x 100. Score raw Scribe output against a manually checked transcript. |
| Intent accuracy | Correct intent labels / total labelled cases x 100. Report per language and overall. |
| E2E latency | Timestamp from end-of-turn detection to first audible TTS sample. Also log Scribe, fusion, TTS and UI delay separately. |
| User effort | Mean number of taps / edits / re-prompts per successfully communicated message. |

| **RUN AN ABLATION TEST** Run the same labelled scenarios twice: (A) transcript + dialogue context only; (B) transcript + dialogue context + MediaPipe cues. Compare intent accuracy and correction effort. Do not claim gestures improve WER unless you actually measure corrected text against reference transcripts. |
| --- |

## Latency reality check

The PS sets an under-2-second target. ElevenLabs publishes low median latency for Scribe Realtime and Flash TTS, but those vendor figures exclude your network, UI, LLM, turn detection and any avatar rendering [5, 6]. A complete turn may exceed two seconds. Measure p50 and p95 on the actual demo machine; do not copy provider latency as system latency.

## Definition of done for the core pipeline

Both speaker turns are captured and labelled; patient transcript and recent conversation context are visible.

MediaPipe returns stable gesture and face/mouth activity features with timestamps.

LLM returns valid ranked candidates or an explicit clarification request.

Patient can confirm / edit / reject; no unconfirmed reply is spoken.

ElevenLabs speaks the confirmed sentence; logs include language, WER reference, intent label and latency.

**08  /  OPTIONAL EXTENSION - AVATARS**

# Only after the basic pipeline is complete

Avatar generation is a stretch goal. Do not put it on the critical path for the 12-hour build.

| **GATE BEFORE STARTING AVATAR WORK** The baseline is complete only when: (1) speech + vision + context fusion works, (2) patient confirmation works, (3) ElevenLabs TTS works, and (4) you have run repeatable test scenarios. If any item is missing, finish the core first. |
| --- |

## Option A - 2D photorealistic talking portrait

Use a participant-consented portrait / reference video with confirmed ElevenLabs audio to generate a talking-head clip. This can preserve visual likeness, but GPU rendering may be slow.

| **TOOL** | **USE** | **PRACTICAL NOTES** |
| --- | --- | --- |
| MuseTalk 1.5 | Audio-driven lip synchronisation on a source face image / video. | MIT code licence; check individual dependency, model and asset terms. Authors report 30+ FPS on Tesla V100 after avatar preparation; their RTX 3050 Ti 4 GB test took about 5 minutes for an 8-second clip. Not a safe assumption for a <2-second live output [16]. |
| LivePortrait (optional) | Add natural portrait motion / expression transfer from a driving video. | Useful for idle movement / expression experiments. It is not a complete audio-to-lip-sync engine by itself [18]. |

2D pipeline: confirmed text -> ElevenLabs audio -> MuseTalk inference with enrolled face/video -> rendered MP4 -> display. For the hackathon, render a short clip after confirmation and keep a still portrait + audio fallback.

## Option B - interactive 3D avatar in the browser

Render a personalised 3D character in the browser and animate its mouth from confirmed audio. It can support continuous interaction, but likeness depends on the quality and licence of the 3D asset.

| **TOOL** | **USE** | **PRACTICAL NOTES** |
| --- | --- | --- |
| TalkingHead (JavaScript / Three.js) | Browser 3D avatar renderer with real-time lip-sync and facial expressions. | MIT code. Requires a GLB model with Mixamo-compatible rig plus ARKit / Oculus viseme blend shapes. Can integrate external TTS such as ElevenLabs when timing data is available [17]. |
| Blender | Prepare / edit / optimise the GLB avatar and rig. | Open-source 3D content tool. More manual work than 2D; do not attempt full custom modelling inside the first 12 hours. |
| Avaturn (optional service) | Generate a 3D avatar from participant photos. | Not an open-source library. Its terms vary by use; verify the applicable licence before public, commercial or redistributed use. The TalkingHead repository documents compatible Avaturn avatar types [17]. |

## 2D vs 3D - which should you choose?

| **DECISION** | **2D: MUSETALK** | **3D: TALKINGHEAD** |
| --- | --- | --- |
| Visual identity | Can preserve the look of a real portrait closely. | Depends on the 3D reconstruction / model quality. |
| Runtime | GPU video generation; may be slower than target latency. | Browser rendering; can be responsive once compatible avatar is ready. |
| Setup effort | Lower if a suitable face photo/video is ready. | Higher: obtain / create a rigged GLB with correct blend shapes. |
| Best use in demo | High-impact talking-head clip after a confirmed reply. | Interactive, persistent avatar on the application screen. |

**09  /  DATASETS ****&**** RESEARCH MAP**

# Useful projects to study - not all belong in the MVP

| **PROJECT / DATASET** | **WHY IT MATTERS** | **WHEN TO USE** |
| --- | --- | --- |
| Auto-AVSR | Open-source audio-visual speech recognition / lip-reading research pipeline. Apache-2.0 code; checkpoint/data terms need separate review [11]. | Later: genuine lip-reading / audio-visual ASR research. |
| AV-HuBERT | Self-supervised audio-visual speech representation and lip-reading research. Official GitHub repository is archived (read-only) [12]. | Research reference, not a 12-hour dependency. |
| TORGO | Acoustic-articulatory dysarthric speech corpus; University of Toronto lists 8 dysarthric and 7 control participants [13]. | Speech-recognition experiments, subject to dataset access / conditions. |
| UA-Speech | Dysarthric speech corpus; current distribution includes 16 speakers. Access limited to government / academic research labs; commercial use prohibited [14]. | Research-only; do not assume hackathon or commercial use is permitted. |
| Cboard | Open-source Augmentative and Alternative Communication board with symbol-based communication and text-to-speech [15]. | UI / accessibility inspiration for large response buttons and AAC fallback. |

| **IMPORTANT DATASET NOTE** The PS suggests TORGO or UA-Speech, but dataset terms still apply. UA-Speech explicitly prohibits commercial use and restricts access to government / academic research labs. For a hackathon demo, your safest route is to record clearly labelled, consented volunteer examples; do not redistribute research datasets. |
| --- |

## Official references and repositories

[1] Supplied source: PS-16 - Multimodal Live Conversation Assistant for People with Speech Impairments.  *Provided by the team*

[2] Google AI Edge - MediaPipe Face Landmarker.  [Open reference](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)

[3] Google AI Edge - MediaPipe Gesture Recognizer overview.  [Open reference](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)

[4] Google AI Edge - Gesture Recognizer for Python.  [Open reference](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/python)

[5] ElevenLabs - Scribe v2 Realtime server-side streaming.  [Open reference](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/server-side-streaming)

[6] ElevenLabs - Model selection, languages and latency overview.  [Open reference](https://elevenlabs.io/docs/overview/intro)

[7] ElevenLabs - Voice cloning overview and verification.  [Open reference](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning)

[8] Gradio - Streaming inputs.  [Open reference](https://gradio.app/guides/streaming-inputs)

[9] Gradio - Audio component documentation.  [Open reference](https://gradio.app/docs/audio)

[10] Groq - Supported model IDs.  [Open reference](https://console.groq.com/docs/models)

[11] GitHub - Auto-AVSR (Apache-2.0 code).  [Open reference](https://github.com/mpc001/auto_avsr)

[12] GitHub - AV-HuBERT (archived repository).  [Open reference](https://github.com/facebookresearch/av_hubert)

[13] University of Toronto - TORGO listing.  [Open reference](https://www.cs.toronto.edu/compling/downloads.html)

[14] University of Illinois - UA-Speech corpus and restrictions.  [Open reference](https://speechtechnology.web.illinois.edu/uaspeech/)

[15] GitHub - Cboard AAC communication board (GPL-3.0).  [Open reference](https://github.com/cboard-org/cboard)

[16] GitHub - MuseTalk.  [Open reference](https://github.com/TMElyralab/MuseTalk)

[17] GitHub - TalkingHead 3D.  [Open reference](https://github.com/met4citizen/talkinghead)

[18] GitHub - LivePortrait.  [Open reference](https://github.com/KwaiVGI/LivePortrait)

**BUILD BLUEPRINT  |  31 OCT 2026     •     PAGE **