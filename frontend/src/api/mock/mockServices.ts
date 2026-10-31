/**
 * In-memory mock backend. It enforces the same rules as the real FastAPI backend:
 *  - consent gates capture and voice cloning (each purpose separately)
 *  - partial transcripts are never stored as turns
 *  - only a confirmed message can be spoken; pending / rejected / clarification proposals cannot
 *  - repeating the same decision is idempotent; a different decision on a closed proposal is refused
 * Nothing here is a measurement. No audio, video or sample file is read, uploaded or stored.
 */
import type { MockControl, Services, SpeechCapture, VoiceSimulation } from "../contracts";
import {
  ApiError,
  type ActionResult,
  type Consent,
  type ConfirmedMessage,
  type EvalCase,
  type EvalReport,
  type EvalReportState,
  type EvidencePacket,
  type GestureMap,
  type Language,
  type Proposal,
  type Session,
  type SessionVoice,
  type Speaker,
  type Turn,
  type TurnMetrics,
  type VoiceInfo,
  DEMO_GESTURE_MAP,
  GESTURE_LABELS,
  MAX_MEANING_CHARS,
  NO_CONSENT,
} from "../types";
import { SCENARIOS, type ScenarioId } from "./scenarios";

export const CLARIFICATION_MESSAGE = "I did not understand - please choose, repeat or clarify.";
const HISTORY_WINDOW = 6;
const MAX_TYPED = 1000;
const MAX_EDIT = 300;

interface SessionRecord {
  session: Session;
  turns: Turn[];
  proposals: Map<string, Proposal>;
  confirmed: Map<string, ConfirmedMessage>;
  attempts: Map<string, number>; // turnId -> fusion attempts
  effort: Map<string, number>; // turnId -> patient decisions in the open chain
  gestureMap: GestureMap;
  metrics: Map<string, TurnMetrics>;
  ended: boolean;
  clockStart: number;
}

export interface MockOptions {
  /** Simulated network delay per call. Tests use 0. */
  delayMs?: number;
  /** Time between scripted partial-transcript frames. */
  partialIntervalMs?: number;
  scenario?: ScenarioId;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

export function createMockServices(opts: MockOptions = {}): Services {
  const delayMs = opts.delayMs ?? 420;
  const partialMs = opts.partialIntervalMs ?? 650;
  let scenarioId: ScenarioId = opts.scenario ?? "water";
  let camera = false;
  let voiceSim: VoiceSimulation = "normal";
  let connection: "online" | "disconnected" | "reconnecting" = "online";
  const listeners = new Set<(s: typeof connection) => void>();
  const db = new Map<string, SessionRecord>();
  let evalReport: EvalReport | null = null;

  const scenario = () => SCENARIOS[scenarioId];
  const wait = (ms = delayMs) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
  const setConnection = (s: typeof connection) => {
    connection = s;
    listeners.forEach((cb) => cb(s));
  };

  async function call<T>(fn: () => T): Promise<T> {
    await wait();
    if (connection !== "online") throw new ApiError("network_error", "The service is not reachable. Your draft is kept.");
    return fn();
  }

  function rec(id: string): SessionRecord {
    const r = db.get(id);
    if (!r) throw new ApiError("not_found", "This session does not exist or was deleted.", 404);
    return r;
  }
  function active(id: string): SessionRecord {
    const r = rec(id);
    if (r.ended) throw new ApiError("invalid_state", "This session has ended.", 409);
    return r;
  }
  const now = (r: SessionRecord) => Date.now() - r.clockStart;

  function addTurn(r: SessionRecord, speaker: Speaker, text: string, language: Language, source: Turn["source"]): Turn {
    const t: Turn = { id: uid("turn"), speaker, text, language, timestampMs: now(r), source };
    r.turns.push(t);
    return t;
  }

  function evidenceFor(r: SessionRecord, turn: Turn, includeCues: boolean): EvidencePacket {
    const idx = r.turns.findIndex((t) => t.id === turn.id);
    const context = r.turns.slice(Math.max(0, idx - HISTORY_WINDOW), idx).map((t) => ({ speaker: t.speaker, text: t.text }));
    const sc = scenario();
    const cuesOn = includeCues && camera && r.session.consent.face_capture && !sc.devicesUnavailable;
    const g = cuesOn && sc.gesture?.stable ? sc.gesture : null;
    return {
      speaker: "patient",
      transcript: turn.text,
      language: turn.language,
      timestamp_ms: turn.timestampMs,
      conversation_context: context,
      visual_cues: {
        gesture: g ? { label: g.label, score: g.score, meaning: r.gestureMap[g.label] ?? null } : null,
        mouth_activity: cuesOn && sc.mouthActivity,
        head_nod: false,
      },
    };
  }

  function closeChain(r: SessionRecord, p: Proposal) {
    r.effort.delete(p.turnId);
  }
  function bump(r: SessionRecord, p: Proposal) {
    const n = (r.effort.get(p.turnId) ?? 0) + 1;
    r.effort.set(p.turnId, n);
    return n;
  }
  function proposalOf(r: SessionRecord, pid: string): Proposal {
    const p = r.proposals.get(pid);
    if (!p) throw new ApiError("not_found", "Suggestion not found.", 404);
    return p;
  }
  const conflict = (p: Proposal) => new ApiError("invalid_state", `This suggestion is already ${p.state.replace(/_/g, " ")}.`, 409);
  const existing = (r: SessionRecord, p: Proposal) => [...r.confirmed.values()].find((m) => m.proposalId === p.id)!;

  function issue(r: SessionRecord, p: Proposal, text: string, how: "candidate" | "edited", index: number | null): ActionResult {
    if (p.state !== "pending") throw conflict(p);
    const effort = bump(r, p);
    const msg: ConfirmedMessage = { id: uid("confirmed"), proposalId: p.id, text, how, candidateIndex: index, effortActions: effort };
    r.confirmed.set(msg.id, msg);
    closeChain(r, p);
    p.state = how === "candidate" ? "confirmed" : "edited_confirmed";
    const m = r.metrics.get(p.turnId);
    if (m) m.humanWaitMs = null;
    return { proposal: { ...p }, confirmed: msg, effortActions: effort };
  }

  const control: MockControl = {
    scenario: () => scenarioId,
    setScenario: (id) => {
      scenarioId = id;
      setConnection("online");
    },
    async prepareScenarioSession(id) {
      scenarioId = id;
      setConnection("online");
      const sc = SCENARIOS[id];
      const session = await services.sessions.create(sc.language);
      await services.sessions.setConsent(session.id, { audio_recording: true, face_capture: false, voice_cloning: false, demo_use: false });
      const r = rec(session.id);
      addTurn(r, "partner", sc.partner.committed, sc.language, "scribe_realtime");
      addTurn(r, "patient", sc.patient.committed, sc.language, "scribe_realtime");
      if (sc.endedSession) r.ended = true;
      if (sc.deletedSession) db.delete(session.id);
      return session.id;
    },
    cameraOn: () => camera,
    setCameraOn: (on) => {
      camera = on;
    },
    voiceSimulation: () => voiceSim,
    setVoiceSimulation: (v) => {
      voiceSim = v;
    },
    simulateDisconnect: () => setConnection("disconnected"),
  };

  function voiceGuard() {
    if (voiceSim === "unavailable") throw new ApiError("not_configured", "The voice service is not configured.", 503);
    if (voiceSim === "provider_error") throw new ApiError("upstream_error", "The voice provider returned an error. Try again later.", 502);
  }

  const services: Services = {
    mode: "mock",
    mock: control,
    sessions: {
      create: (language) =>
        call(() => {
          const session: Session = { id: uid("session"), language, consent: { ...NO_CONSENT }, voice: null, createdAt: new Date().toISOString() };
          db.set(session.id, {
            session,
            turns: [],
            proposals: new Map(),
            confirmed: new Map(),
            attempts: new Map(),
            effort: new Map(),
            gestureMap: { ...DEMO_GESTURE_MAP },
            metrics: new Map(),
            ended: false,
            clockStart: Date.now(),
          });
          return { ...session, consent: { ...session.consent } };
        }),
      setConsent: (id, c) =>
        call(() => {
          const r = rec(id);
          const consent: Consent = {
            audio_recording: c.audio_recording === true,
            face_capture: c.face_capture === true,
            voice_cloning: c.voice_cloning === true,
            demo_use: c.demo_use === true,
            recordedAt: new Date().toISOString(),
          };
          r.session = { ...r.session, consent };
          return { ...r.session };
        }),
      get: (id) => call(() => ({ ...rec(id).session })),
      end: (id) =>
        call(() => {
          rec(id).ended = true;
        }),
      delete: (id) =>
        call(() => {
          rec(id);
          db.delete(id);
        }),
    },
    conversation: {
      history: (id) => call(() => [...rec(id).turns]),
      addTypedTurn: (id, speaker, text, language) =>
        call(() => {
          const r = active(id);
          const clean = text.trim();
          if (!clean) throw new ApiError("validation_error", "Type a message first.", 422);
          if (clean.length > MAX_TYPED) throw new ApiError("validation_error", `Messages can be up to ${MAX_TYPED} characters.`, 422);
          return addTurn(r, speaker, clean, language, "typed");
        }),
      async startCapture(id, speaker, language) {
        await wait();
        if (connection !== "online") throw new ApiError("network_error", "The service is not reachable.");
        const r = active(id);
        if (scenario().devicesUnavailable) throw new ApiError("not_configured", "No microphone is available. You can type instead.", 503);
        if (!r.session.consent.audio_recording)
          throw new ApiError("consent_required", "Audio recording consent is off for this session.", 403);
        const script = speaker === "patient" ? scenario().patient : scenario().partner;
        let cb: ((p: { speaker: Speaker; text: string }) => void) | null = null;
        let i = 0;
        let timer: ReturnType<typeof setInterval> | null = null;
        const emit = () => {
          if (i < script.partials.length) cb?.({ speaker, text: script.partials[i++] });
        };
        const capture: SpeechCapture = {
          onPartial(fn) {
            cb = fn;
            emit();
            timer = setInterval(emit, partialMs);
          },
          async finish() {
            if (timer) clearInterval(timer);
            cb = null;
            await wait();
            if (connection !== "online") throw new ApiError("network_error", "The service is not reachable.");
            const rr = active(id);
            return addTurn(rr, speaker, script.committed, language, "scribe_realtime");
          },
          cancel() {
            if (timer) clearInterval(timer);
            cb = null;
          },
        };
        return capture;
      },
      finishTurn: (id, { includeVisualCues }) =>
        call(() => {
          const r = active(id);
          const turn = [...r.turns].reverse().find((t) => t.speaker === "patient");
          if (!turn) throw new ApiError("invalid_state", "There is no patient turn yet. Record or type the patient’s answer first.", 409);
          const attempt = r.attempts.get(turn.id) ?? 0;
          r.attempts.set(turn.id, attempt + 1);
          const sc = scenario();
          const plan = sc.attempts[Math.min(attempt, sc.attempts.length - 1)];
          const evidence = evidenceFor(r, turn, includeVisualCues);
          let fusion;
          if (!turn.text.trim() && !evidence.visual_cues.gesture) {
            fusion = { intent: "unclear", candidateReplies: [], clarificationRequired: true, reasoningSummary: "No words and no stable gesture to interpret." };
          } else if (turn.source === "typed" && turn.text !== sc.patient.committed) {
            // A typed message is the patient's own words, so it is offered first, verbatim.
            const candidates = [turn.text, ...plan.candidates.filter((c) => c !== turn.text)].slice(0, 3);
            fusion = { intent: plan.clarify ? "typed_message" : plan.intent, candidateReplies: candidates, clarificationRequired: false, reasoningSummary: "The patient typed this message." };
          } else {
            fusion = { intent: plan.intent, candidateReplies: [...plan.candidates], clarificationRequired: plan.clarify, reasoningSummary: plan.reason };
          }
          const proposal: Proposal = {
            id: uid("proposal"),
            turnId: turn.id,
            fusion,
            state: "pending",
            evidence,
            clarificationMessage: fusion.clarificationRequired ? CLARIFICATION_MESSAGE : null,
            stageMs: delayMs,
          };
          r.proposals.set(proposal.id, proposal);
          r.metrics.set(turn.id, {
            turnId: turn.id,
            language: turn.language,
            intent: fusion.intent,
            clarificationRequired: fusion.clarificationRequired,
            fusionMs: delayMs,
            ttsFirstAudioMs: null,
            systemLatencyMs: null,
            wallClockMs: null,
            humanWaitMs: null,
          });
          if (sc.disconnectAfterFusion && attempt === 0) setTimeout(() => setConnection("disconnected"), 0);
          return { ...proposal };
        }),
      confirm: (id, pid, index) =>
        call(() => {
          const r = active(id);
          const p = proposalOf(r, pid);
          if (p.state === "confirmed") {
            const m = existing(r, p);
            if (m.candidateIndex === index) return { proposal: { ...p }, confirmed: m, effortActions: m.effortActions };
            throw conflict(p);
          }
          if (p.state !== "pending") throw conflict(p);
          const replies = p.fusion.candidateReplies;
          if (!replies.length) throw new ApiError("invalid_state", "There is nothing to confirm. Edit, repeat or clarify instead.", 409);
          if (!Number.isInteger(index) || index < 0 || index >= replies.length)
            throw new ApiError("validation_error", "That suggestion does not exist.", 422);
          return issue(r, p, replies[index], "candidate", index);
        }),
      edit: (id, pid, text) =>
        call(() => {
          const r = active(id);
          const p = proposalOf(r, pid);
          const clean = text.trim();
          if (!clean) throw new ApiError("validation_error", "The edited message cannot be empty.", 422);
          if (clean.length > MAX_EDIT) throw new ApiError("validation_error", `Edited messages can be up to ${MAX_EDIT} characters.`, 422);
          if (p.state === "edited_confirmed") {
            const m = existing(r, p);
            if (m.text === clean) return { proposal: { ...p }, confirmed: m, effortActions: m.effortActions };
            throw conflict(p);
          }
          if (p.state !== "pending") throw conflict(p);
          return issue(r, p, clean, "edited", null);
        }),
      reject: (id, pid) =>
        call(() => {
          const r = active(id);
          const p = proposalOf(r, pid);
          if (p.state === "rejected") return { proposal: { ...p }, confirmed: null, effortActions: r.effort.get(p.turnId) ?? 0 };
          if (p.state !== "pending") throw conflict(p);
          const effort = bump(r, p);
          p.state = "rejected";
          return { proposal: { ...p }, confirmed: null, effortActions: effort };
        }),
      clarify: (id, pid) =>
        call(() => {
          const r = active(id);
          const p = proposalOf(r, pid);
          if (p.state === "clarification_requested") return { proposal: { ...p }, confirmed: null, effortActions: r.effort.get(p.turnId) ?? 0 };
          if (p.state !== "pending") throw conflict(p);
          const effort = bump(r, p);
          p.state = "clarification_requested";
          return { proposal: { ...p }, confirmed: null, effortActions: effort };
        }),
      speak: (id, confirmedId) =>
        call(() => {
          const r = active(id);
          const msg = r.confirmed.get(confirmedId);
          if (!msg) {
            if (r.proposals.has(confirmedId)) throw new ApiError("invalid_state", "Only a confirmed message can be spoken.", 409);
            throw new ApiError("not_found", "Confirmed message not found.", 404);
          }
          const p = r.proposals.get(msg.proposalId);
          const m = p ? r.metrics.get(p.turnId) : undefined;
          if (m && m.ttsFirstAudioMs === null) {
            m.ttsFirstAudioMs = delayMs;
            m.systemLatencyMs = delayMs * 2;
          }
          return { audioUrl: null, subtitle: msg.text, firstAudioMs: delayMs, persona: r.session.voice?.persona ?? "text_only" };
        }),
      metrics: (id) => call(() => [...rec(id).metrics.values()].map((m) => ({ ...m }))),
    },
    vision: {
      cues: (id) =>
        call(() => {
          const r = rec(id);
          const sc = scenario();
          if (!camera || !r.session.consent.face_capture || sc.devicesUnavailable) return null;
          const g = sc.gesture;
          return {
            timestampMs: now(r),
            faceDetected: true,
            mouthActivity: sc.mouthActivity,
            headNod: false,
            gesture: g ? { ...g, meaning: r.gestureMap[g.label] ?? null } : null,
            stale: false,
          };
        }),
      setGestureMap: (id, map) =>
        call(() => {
          const r = rec(id);
          const clean: GestureMap = {};
          for (const [label, meaning] of Object.entries(map)) {
            if (!GESTURE_LABELS.includes(label as never)) throw new ApiError("validation_error", `Unknown gesture “${label}”.`, 422);
            const m = (meaning ?? "").trim();
            if (!m) continue;
            if (m.length > MAX_MEANING_CHARS) throw new ApiError("validation_error", `Meanings can be up to ${MAX_MEANING_CHARS} characters.`, 422);
            clean[label as keyof GestureMap] = m;
          }
          r.gestureMap = clean;
          return { ...clean };
        }),
    },
    voices: {
      list: () =>
        call((): VoiceInfo[] => {
          voiceGuard();
          return [
            { voiceId: "mock-ember", name: "Ember (example voice)", category: "premade" },
            { voiceId: "mock-juniper", name: "Juniper (example voice)", category: "premade" },
            { voiceId: "mock-saffron", name: "Saffron (example voice)", category: "premade" },
          ];
        }),
      design: (id, name, description) =>
        call((): SessionVoice => {
          voiceGuard();
          const r = rec(id);
          if (!description.trim()) throw new ApiError("validation_error", "Describe the voice first.", 422);
          const voice: SessionVoice = { voiceId: uid("designed"), name: name.trim() || "Designed voice", persona: "designed_voice" };
          r.session = { ...r.session, voice };
          return voice;
        }),
      clone: (id, name) =>
        call((): SessionVoice => {
          const r = rec(id);
          if (!r.session.consent.voice_cloning) throw new ApiError("consent_required", "Voice cloning consent is off for this session.", 403);
          voiceGuard();
          // Mock mode: the sample file is never read, uploaded or stored.
          const voice: SessionVoice = { voiceId: uid("clone"), name: name.trim() || "Personal voice", persona: "cloned_voice" };
          r.session = { ...r.session, voice };
          return voice;
        }),
      preview: (text, voice) =>
        call(() => {
          voiceGuard();
          return { audioUrl: null, subtitle: text, firstAudioMs: delayMs, persona: voice?.persona ?? "text_only" };
        }),
    },
    evaluation: {
      run: (mode) =>
        call((): EvalReportState => {
          if (mode === "live")
            throw new ApiError("not_configured", "Live evaluation needs the backend, API keys and consented recordings.", 503);
          evalReport = buildMockReport();
          return evalReport;
        }),
      report: () => call((): EvalReportState => evalReport ?? { status: "no_runs" }),
      csv: () =>
        call(() => {
          if (!evalReport) throw new ApiError("not_found", "No evaluation run yet.", 404);
          return toCsv(evalReport.cases, evalReport.mode);
        }),
    },
    connection: {
      status: () => connection,
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      health: async () => ({ suggestions: true, speech: true, vision: true }),
      async reconnect() {
        setConnection("reconnecting");
        await wait(Math.max(delayMs, 600));
        setConnection("online");
      },
    },
  };
  return services;
}

// ---------------------------------------------------------------- illustrative evaluation report
const EVAL_CASES: [string, string, Language, boolean, string, boolean, boolean][] = [
  // id, group, language, simulated, expected intent, correct A, correct B   (illustrative only)
  ["clear-01", "clear", "en", false, "request_water", true, true],
  ["clear-02", "clear", "en", false, "request_bathroom", true, true],
  ["clear-03", "clear", "en", false, "request_phone_call", true, true],
  ["clear-04", "clear", "en", false, "request_blanket", true, true],
  ["clear-05", "clear", "en", false, "request_tv_off", true, true],
  ["atypical-01", "atypical", "en", true, "request_water", false, false],
  ["atypical-02", "atypical", "en", true, "request_light_off", false, false],
  ["atypical-03", "atypical", "en", true, "request_rest", false, true],
  ["atypical-04", "atypical", "en", true, "request_phone_call", true, true],
  ["atypical-05", "atypical", "en", true, "request_bathroom", false, false],
  ["gesture-01", "gesture", "en", false, "request_water", false, true],
  ["gesture-02", "gesture", "en", false, "request_light_off", false, true],
  ["gesture-03", "gesture", "en", false, "decline_tea", false, true],
  ["gesture-04", "gesture", "en", false, "request_phone_call", false, true],
  ["gesture-05", "gesture", "en", false, "request_pause", false, true],
  ["context-01", "context", "en", false, "confirm_yes", true, true],
  ["context-02", "context", "en", false, "decline_no", true, true],
  ["context-03", "context", "en", false, "request_tea", true, true],
  ["context-04", "context", "en", false, "confirm_yes", true, true],
  ["context-05", "context", "en", false, "confirm_yes", true, true],
  ["lang-en-01", "language", "en", false, "request_water", true, true],
  ["lang-en-02", "language", "en", false, "request_light_off", true, true],
  ["lang-hi-01", "language", "hi", false, "request_water", true, true],
  ["lang-hi-02", "language", "hi", false, "request_light_off", true, true],
  ["lang-mixed-01", "language", "mixed", false, "request_water", true, true],
  ["lang-mixed-02", "language", "mixed", false, "request_light_off", true, true],
  ["negative-01", "negative", "en", false, "unclear", false, true],
  ["negative-02", "negative", "en", false, "unclear", true, true],
  ["negative-03", "negative", "en", false, "unclear", true, true],
  ["negative-04", "negative", "en", false, "unclear", true, true],
];

function pct(xs: boolean[]): number | null {
  return xs.length ? (xs.filter(Boolean).length / xs.length) * 100 : null;
}

function buildMockReport(): EvalReport {
  const cases: EvalCase[] = EVAL_CASES.flatMap(([caseId, group, language, simulated, expectedIntent, a, b]) =>
    (["A", "B"] as const).map((arm) => {
      const correct = arm === "A" ? a : b;
      return { caseId, arm, group, language, simulated, skipped: false, skipReason: null, correct, intent: correct ? expectedIntent : "unclear", expectedIntent };
    }),
  );
  const summarize = (arm: "A" | "B", label: string, effort: number, sys: [number, number], wall: [number, number]) => {
    const rows = cases.filter((c) => c.arm === arm);
    const by = (key: "language" | "group") =>
      Object.fromEntries([...new Set(rows.map((r) => r[key]))].map((k) => [k, pct(rows.filter((r) => r[key] === k).map((r) => !!r.correct))]));
    return {
      label,
      n: rows.length,
      intentAccuracy: { overall: pct(rows.map((r) => !!r.correct)), byLanguage: by("language"), byGroup: by("group") },
      effortMean: effort,
      systemLatency: { n: 26, p50: sys[0], p95: sys[1], lowSample: false },
      wallClock: { n: 26, p50: wall[0], p95: wall[1], lowSample: false },
    };
  };
  return {
    status: "ok",
    mode: "mock",
    generatedAt: new Date().toISOString(),
    nCases: EVAL_CASES.length,
    nSkipped: 0,
    disclaimer: "mock results are not measurements",
    wer: { overall: 34.3, byLanguage: { en: 41.2, hi: 0, mixed: 0 }, note: "Raw transcript against the reference transcript. Visual cues do not change transcripts." },
    arms: {
      A: summarize("A", "Transcript + conversation context", 1.38, [1420, 2310], [1460, 2380]),
      B: summarize("B", "Transcript + conversation context + visual cues", 1.19, [1450, 2350], [1490, 2420]),
    },
    cases,
  };
}

export function toCsv(cases: EvalCase[], mode: string): string {
  const cols = ["case_id", "arm", "group", "language", "simulated", "skipped", "skip_reason", "mode", "expected_intent", "intent", "correct"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = cases.map((c) =>
    [c.caseId, c.arm, c.group, c.language, c.simulated, c.skipped, c.skipReason, mode, c.expectedIntent, c.intent, c.correct].map(esc).join(","),
  );
  return [cols.join(","), ...rows].join("\n") + "\n";
}
