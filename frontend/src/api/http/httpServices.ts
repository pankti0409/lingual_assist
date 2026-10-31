/**
 * HTTP adapter for the Lingual Assist FastAPI backend. Maps the backend's snake_case JSON to the
 * frontend domain types. No API keys live here: the browser only talks to our own backend.
 */
import type { Services, SpeechCapture } from "../contracts";
import {
  ApiError,
  type ActionResult,
  type ApiErrorCode,
  type ArmSummary,
  type ConfirmedMessage,
  type EvalReportState,
  type Language,
  type Proposal,
  type Session,
  type SessionVoice,
  type Turn,
  type VoicePersona,
} from "../types";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createHttpServices(baseUrl: string): Services {
  const base = baseUrl.replace(/\/$/, "");
  let connection: "online" | "disconnected" | "reconnecting" = "online";
  const listeners = new Set<(s: typeof connection) => void>();
  const voices = new Map<string, SessionVoice>(); // the session response only carries voice_mode
  const setConnection = (s: typeof connection) => {
    connection = s;
    listeners.forEach((cb) => cb(s));
  };

  async function raw(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, init);
    } catch {
      setConnection("disconnected");
      throw new ApiError("network_error", "The service is not reachable. Your draft is kept.");
    }
    if (connection !== "online") setConnection("online");
    if (!res.ok) {
      let code: ApiErrorCode = "internal_error";
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        code = body?.error?.code ?? code;
        message = body?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(code, message, res.status);
    }
    return res;
  }
  const json = async (path: string, init?: RequestInit): Promise<Json> => (await raw(path, init)).json();
  const post = (path: string, body?: unknown) =>
    json(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  const toSession = (b: Json): Session => ({
    id: b.session_id,
    language: b.language,
    consent: {
      audio_recording: b.consent.audio_recording,
      face_capture: b.consent.face_capture,
      voice_cloning: b.consent.voice_cloning,
      demo_use: b.consent.demo_use,
      recordedAt: b.consent.recorded_at,
    },
    voice: b.voice_mode === "none" ? null : voices.get(b.session_id) ?? { voiceId: "", name: "Session voice", persona: b.voice_mode === "clone" ? "cloned_voice" : "designed_voice" },
    createdAt: b.created_at,
  });
  const toTurn = (t: Json): Turn => ({ id: t.turn_id, speaker: t.speaker, text: t.text, language: t.language, timestampMs: t.timestamp_ms, source: t.source });
  const toProposal = (p: Json, evidence: Json | null = null, clarificationMessage: string | null = null, stageMs = 0): Proposal => ({
    id: p.proposal_id,
    turnId: p.turn_id,
    fusion: {
      intent: p.fusion.intent,
      candidateReplies: p.fusion.candidate_replies,
      clarificationRequired: p.fusion.clarification_required,
      reasoningSummary: p.fusion.reasoning_summary,
    },
    state: p.state,
    evidence: evidence as Proposal["evidence"],
    clarificationMessage,
    stageMs,
  });
  const toConfirmed = (c: Json | null): ConfirmedMessage | null =>
    c && { id: c.confirmed_id, proposalId: c.proposal_id, text: c.text, how: c.how, candidateIndex: c.candidate_index, effortActions: c.effort_actions };
  const toAction = (b: Json): ActionResult => ({ proposal: toProposal(b.proposal), confirmed: toConfirmed(b.confirmed), effortActions: b.effort_actions });
  const toVoice = (b: Json): SessionVoice => {
    const v = { voiceId: b.voice_id, name: b.name, persona: b.persona as VoicePersona };
    voices.set(b.session_id, v);
    return v;
  };
  const latency = (l: Json) => ({ n: l.n, p50: l.p50, p95: l.p95, lowSample: l.p95_low_sample });
  const accMap = (m: Json) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, (v as Json).accuracy]));
  const toArm = (a: Json): ArmSummary => ({
    label: a.label,
    n: a.n,
    intentAccuracy: { overall: a.intent_accuracy.overall.accuracy, byLanguage: accMap(a.intent_accuracy.by_language), byGroup: accMap(a.intent_accuracy.by_group) },
    effortMean: a.effort.overall.mean_actions,
    systemLatency: latency(a.latency.system_latency_ms),
    wallClock: latency(a.latency.wall_clock_ms),
  });
  const toReport = (r: Json): EvalReportState =>
    r.status === "no_runs"
      ? { status: "no_runs" }
      : {
          status: "ok",
          mode: r.mode,
          generatedAt: r.generated_at,
          nCases: r.n_cases,
          nSkipped: r.n_skipped,
          disclaimer: r.disclaimer ?? null,
          wer: {
            overall: r.wer.overall.wer,
            byLanguage: Object.fromEntries(Object.entries(r.wer.by_language ?? {}).map(([k, v]) => [k, (v as Json).wer])),
            note: r.wer.note,
          },
          arms: { A: toArm(r.arms.A), B: toArm(r.arms.B) },
          cases: (r.cases ?? []).map((c: Json) => ({
            caseId: c.case_id,
            arm: c.arm,
            group: c.group,
            language: c.language,
            simulated: c.simulated,
            skipped: c.skipped,
            skipReason: c.skip_reason ?? null,
            correct: c.correct ?? null,
            intent: c.intent ?? null,
            expectedIntent: c.expected_intent,
          })),
        };

  return {
    mode: "http",
    sessions: {
      create: async (language) => toSession(await post("/sessions", { language })),
      setConsent: async (id, c) =>
        toSession(await post(`/sessions/${id}/consent`, { audio_recording: c.audio_recording, face_capture: c.face_capture, voice_cloning: c.voice_cloning, demo_use: c.demo_use })),
      get: async (id) => toSession(await json(`/sessions/${id}`)),
      // The backend has no "end" endpoint; ending is tracked client-side (the session store makes it read-only).
      end: async () => undefined,
      delete: async (id) => {
        await raw(`/sessions/${id}`, { method: "DELETE" });
        voices.delete(id);
      },
    },
    conversation: {
      history: async (id) => ((await json(`/sessions/${id}/history?limit=200`)).turns as Json[]).map(toTurn),
      addTypedTurn: async (id, speaker, text, language) => toTurn(await post(`/sessions/${id}/turns/text`, { speaker, text, language })),
      async startCapture(id, speaker, language: Language) {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
          throw new ApiError("not_configured", "Recording is not supported in this browser. You can type instead.");
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          const denied = e instanceof DOMException && e.name === "NotAllowedError";
          throw new ApiError(denied ? "consent_required" : "not_configured", denied ? "Microphone permission was denied." : "No microphone is available.");
        }
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.start();
        const stop = () => new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          if (recorder.state !== "inactive") recorder.stop();
          else resolve();
          stream.getTracks().forEach((t) => t.stop());
        });
        const capture: SpeechCapture = {
          // Batch upload: partial transcripts need the realtime stream (PCM16 16 kHz), not used in this build.
          onPartial() {},
          async finish() {
            await stop();
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            const form = new FormData();
            form.append("audio", blob, "turn.webm");
            form.append("speaker", speaker);
            form.append("language", language);
            const body = await json(`/sessions/${id}/transcribe`, { method: "POST", body: form });
            return body.turn ? toTurn(body.turn) : null;
          },
          cancel() {
            void stop();
          },
        };
        return capture;
      },
      async finishTurn(id, { includeVisualCues }) {
        const b = await post(`/sessions/${id}/turn/finish`, { include_visual_cues: includeVisualCues });
        return toProposal(b.proposal, b.evidence, b.clarification_message, b.stage_ms);
      },
      confirm: async (id, pid, index) => toAction(await post(`/sessions/${id}/proposals/${pid}/confirm`, { candidate_index: index })),
      edit: async (id, pid, text) => toAction(await post(`/sessions/${id}/proposals/${pid}/edit`, { text })),
      reject: async (id, pid) => toAction(await post(`/sessions/${id}/proposals/${pid}/reject`)),
      clarify: async (id, pid) => toAction(await post(`/sessions/${id}/proposals/${pid}/clarify`)),
      async speak(id, confirmedId) {
        const res = await raw(`/sessions/${id}/speak`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmed_id: confirmedId }),
        });
        const blob = await res.blob();
        return {
          audioUrl: URL.createObjectURL(blob),
          subtitle: decodeURIComponent(res.headers.get("x-subtitle-text") ?? ""),
          firstAudioMs: Number(res.headers.get("x-first-audio-ms") ?? 0),
          persona: (res.headers.get("x-voice-persona") as VoicePersona) ?? "default_voice",
        };
      },
      metrics: async (id) =>
        ((await json(`/sessions/${id}/metrics`)).turns as Json[]).map((m) => ({
          turnId: m.turn_id,
          language: m.language,
          intent: m.intent,
          clarificationRequired: m.clarification_required,
          fusionMs: m.fusion_ms,
          ttsFirstAudioMs: m.tts_first_audio_ms,
          systemLatencyMs: m.system_latency_ms,
          wallClockMs: m.wall_clock_ms,
          humanWaitMs: m.human_wait_ms,
        })),
    },
    vision: {
      async cues(id) {
        const b = await json(`/sessions/${id}/vision/cues`);
        if (!b.cue) return null;
        const c = b.cue;
        return {
          timestampMs: c.timestamp_ms,
          faceDetected: c.face.detected,
          mouthActivity: c.face.mouth_activity,
          headNod: c.face.head_nod,
          gesture: c.gesture && { label: c.gesture.label, score: c.gesture.score, stable: c.gesture.stable, meaning: c.gesture.meaning },
          stale: b.stale,
        };
      },
      setGestureMap: async (id, map) => (await json(`/sessions/${id}/gesture-map`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(map) })).gesture_map,
    },
    voices: {
      list: async () => ((await json("/voices")).voices as Json[]).map((v) => ({ voiceId: v.voice_id, name: v.name, category: v.category })),
      design: async (sessionId, name, description) => toVoice(await post("/voices/design", { session_id: sessionId, name, description })),
      async clone(sessionId, name, sample) {
        const form = new FormData();
        form.append("sample", sample);
        form.append("name", name);
        form.append("session_id", sessionId);
        return toVoice(await json("/voices/clone", { method: "POST", body: form }));
      },
      async preview() {
        throw new ApiError("not_configured", "Voice preview needs a confirmed message in a live session.");
      },
    },
    evaluation: {
      run: async (mode) => {
        await post("/eval/run", { mode });
        return toReport(await json("/eval/report"));
      },
      report: async () => toReport(await json("/eval/report")),
      csv: async () => (await raw("/eval/report.csv")).text(),
    },
    connection: {
      status: () => connection,
      subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      async health() {
        const h = await json("/health");
        return {
          suggestions: !!h.services?.groq,
          speech: !!h.services?.elevenlabs,
          vision: !!(h.assets?.face_landmarker && h.assets?.gesture_recognizer),
        };
      },
      async reconnect() {
        setConnection("reconnecting");
        try {
          await raw("/health");
          setConnection("online");
        } catch {
          setConnection("disconnected");
        }
      },
    },
  };
}
