/** Domain types shared by every service adapter. They mirror the FastAPI backend contracts. */

export type Language = "en" | "hi" | "mixed";
export type Speaker = "patient" | "partner";
export type TurnSource = "scribe_batch" | "scribe_realtime" | "typed";
export type ConsentPurpose = "audio_recording" | "face_capture" | "voice_cloning" | "demo_use";

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  mixed: "Hindi–English mix",
};

export const CONSENT_PURPOSES: ConsentPurpose[] = ["audio_recording", "face_capture", "voice_cloning", "demo_use"];

export interface Consent {
  audio_recording: boolean;
  face_capture: boolean;
  voice_cloning: boolean;
  demo_use: boolean;
  recordedAt: string | null;
}

export const NO_CONSENT: Consent = {
  audio_recording: false,
  face_capture: false,
  voice_cloning: false,
  demo_use: false,
  recordedAt: null,
};

export type VoicePersona = "designed_voice" | "cloned_voice" | "default_voice";

export interface SessionVoice {
  voiceId: string;
  name: string;
  persona: VoicePersona;
}

export interface Session {
  id: string;
  language: Language;
  consent: Consent;
  voice: SessionVoice | null;
  createdAt: string;
}

export interface Turn {
  id: string;
  speaker: Speaker;
  text: string;
  language: Language;
  timestampMs: number;
  source: TurnSource;
}

/** A transcript still being spoken. It is never a Turn and never enters history. */
export interface PartialTranscript {
  speaker: Speaker;
  text: string;
}

export type GestureLabel =
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou"
  | "None";

export const GESTURE_LABELS: GestureLabel[] = [
  "Closed_Fist",
  "Open_Palm",
  "Pointing_Up",
  "Thumb_Down",
  "Thumb_Up",
  "Victory",
  "ILoveYou",
  "None",
];

export type GestureMap = Partial<Record<GestureLabel, string>>;
export const DEMO_GESTURE_MAP: GestureMap = { Thumb_Up: "yes", Open_Palm: "pause", Thumb_Down: "no" };
export const MAX_MEANING_CHARS = 40;

export interface GestureCue {
  label: GestureLabel;
  score: number;
  stable: boolean;
  meaning: string | null;
}

export interface VisualCues {
  timestampMs: number;
  faceDetected: boolean;
  mouthActivity: boolean;
  headNod: boolean;
  gesture: GestureCue | null;
  stale: boolean;
}

export interface EvidencePacket {
  speaker: "patient";
  transcript: string;
  language: Language;
  timestamp_ms: number;
  conversation_context: { speaker: Speaker; text: string }[];
  visual_cues: {
    gesture: { label: string; score: number; meaning: string | null } | null;
    mouth_activity: boolean;
    head_nod: boolean;
  };
}

export interface FusionResult {
  intent: string;
  candidateReplies: string[];
  clarificationRequired: boolean;
  reasoningSummary: string;
}

export type ProposalState = "pending" | "confirmed" | "edited_confirmed" | "rejected" | "clarification_requested";

export interface Proposal {
  id: string;
  turnId: string;
  fusion: FusionResult;
  state: ProposalState;
  evidence: EvidencePacket;
  clarificationMessage: string | null;
  stageMs: number;
}

export interface ConfirmedMessage {
  id: string;
  proposalId: string;
  text: string;
  how: "candidate" | "edited";
  candidateIndex: number | null;
  effortActions: number;
}

export interface ActionResult {
  proposal: Proposal;
  confirmed: ConfirmedMessage | null;
  effortActions: number;
}

export interface SpeakResult {
  /** Object URL for real audio, or null when playback is simulated (mock mode, text-only). */
  audioUrl: string | null;
  subtitle: string;
  firstAudioMs: number;
  persona: VoicePersona | "text_only";
}

export interface TurnMetrics {
  turnId: string;
  language: Language;
  intent: string | null;
  clarificationRequired: boolean | null;
  fusionMs: number | null;
  ttsFirstAudioMs: number | null;
  systemLatencyMs: number | null;
  wallClockMs: number | null;
  humanWaitMs: number | null;
}

export interface VoiceInfo {
  voiceId: string;
  name: string;
  category: string | null;
}

export type EvalMode = "mock" | "live";

export interface ArmSummary {
  label: string;
  n: number;
  intentAccuracy: { overall: number | null; byLanguage: Record<string, number | null>; byGroup: Record<string, number | null> };
  effortMean: number | null;
  systemLatency: { n: number; p50: number | null; p95: number | null; lowSample: boolean };
  wallClock: { n: number; p50: number | null; p95: number | null; lowSample: boolean };
}

export interface EvalCase {
  caseId: string;
  arm: "A" | "B";
  group: string;
  language: Language;
  simulated: boolean;
  skipped: boolean;
  skipReason: string | null;
  correct: boolean | null;
  intent: string | null;
  expectedIntent: string;
}

export interface EvalReport {
  status: "ok";
  mode: EvalMode;
  generatedAt: string;
  nCases: number;
  nSkipped: number;
  disclaimer: string | null;
  wer: { overall: number | null; byLanguage: Record<string, number | null>; note: string };
  arms: { A: ArmSummary; B: ArmSummary };
  cases: EvalCase[];
}

export type EvalReportState = { status: "no_runs" } | EvalReport;

/** Typed error used by every adapter; `code` mirrors the backend error codes. */
export type ApiErrorCode =
  | "consent_required"
  | "not_found"
  | "invalid_state"
  | "too_large"
  | "validation_error"
  | "upstream_error"
  | "not_configured"
  | "network_error"
  | "internal_error";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}
